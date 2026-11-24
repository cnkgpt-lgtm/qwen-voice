"""
Backend lokal Qwen3-TTS — clone suara dengan model open-weight asli.

Jalankan di PC dengan GPU (CUDA). TIDAK untuk Vercel (tanpa GPU).

    cd backend
    pip install -r requirements.txt
    python server.py            # http://127.0.0.1:8001

Model default: Qwen/Qwen3-TTS-12Hz-0.6B-Base (paling ringan).
Set env QWEN_MODEL untuk 1.7B-Base bila GPU cukup besar.
Bobot diunduh otomatis dari Hugging Face saat pertama dipakai.

Endpoint (dipakai aplikasi Next.js mode Lokal):
    GET  /health
    POST /api/clone        multipart: ref_audio, ref_text, text, language,
                          model?, x_vector_only_mode?  -> { audio_url }
    POST /api/custom-voice multipart/json: text, language, speaker, instruct?
    POST /api/voice-design multipart/json: text, language, instruct
    GET  /outputs/<file>   hasil WAV
    GET  /api/voices       profil suara tersimpan (ref audio + ref text)

API Python yang dipakai persis dari README QwenLM/Qwen3-TTS:
    Qwen3TTSModel.from_pretrained(...)
    model.generate_voice_clone(text, language, ref_audio, ref_text,
                               x_vector_only_mode=...)
    model.create_voice_clone_prompt(ref_audio, ref_text, ...)
    model.generate_custom_voice(text, language, speaker, instruct)
    model.generate_voice_design(text, language, instruct)
"""

import io
import os
import shutil
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent
VOICES_DIR = BASE_DIR / "voices"
OUTPUTS_DIR = BASE_DIR / "outputs"
VOICES_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

DEFAULT_MODEL = os.environ.get("QWEN_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
PORT = int(os.environ.get("PORT", "8001"))

app = FastAPI(title="Qwen Voice — backend lokal Qwen3-TTS")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_model_name = None


def get_model(name: str):
    """Lazy-load: model 0.6B/1.7B berat, jadi baru dimuat saat pertama dipakai."""
    global _model, _model_name
    if _model is not None and _model_name == name:
        return _model
    import torch
    from qwen_tts import Qwen3TTSModel

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    kwargs: dict = {"device_map": device, "dtype": torch.bfloat16}
    if torch.cuda.is_available():
        try:
            kwargs["attn_implementation"] = "flash_attention_2"
        except Exception:
            pass
    _model = Qwen3TTSModel.from_pretrained(name, **kwargs)
    _model_name = name
    return _model


def save_wav(wavs, sr: int) -> str:
    import soundfile as sf

    name = f"{int(time.time())}-{uuid.uuid4().hex[:8]}.wav"
    sf.write(OUTPUTS_DIR / name, wavs[0], sr)
    return f"/outputs/{name}"


@app.get("/health")
def health():
    import torch

    return {
        "cuda": torch.cuda.is_available(),
        "device": "cuda:0" if torch.cuda.is_available() else "cpu",
        "model": _model_name or DEFAULT_MODEL,
        "model_loaded": _model is not None,
        "status": "ok",
    }


@app.post("/api/clone")
async def clone(
    ref_audio: UploadFile = File(...),
    ref_text: str = Form(""),
    text: str = Form(...),
    language: str = Form("Auto"),
    model: str = Form(DEFAULT_MODEL),
    x_vector_only_mode: bool = Form(False),
):
    if not x_vector_only_mode and not ref_text.strip():
        raise HTTPException(400, "ref_text wajib diisi, kecuali x_vector_only_mode=true.")
    if not text.strip():
        raise HTTPException(400, "text wajib diisi.")
    tmp = VOICES_DIR / f"ref-{uuid.uuid4().hex[:8]}-{ref_audio.filename or 'ref.wav'}"
    with tmp.open("wb") as f:
        shutil.copyfileobj(ref_audio.file, f)
    try:
        tts = get_model(model or DEFAULT_MODEL)
        wavs, sr = tts.generate_voice_clone(
            text=text,
            language=language,
            ref_audio=str(tmp),
            ref_text=ref_text,
            x_vector_only_mode=x_vector_only_mode,
        )
        return {"audio_url": save_wav(wavs, sr), "model": model or DEFAULT_MODEL}
    except Exception as e:  # noqa: BLE001 - sampaikan pesan error apa adanya
        raise HTTPException(500, f"generate_voice_clone gagal: {e}") from e


@app.post("/api/custom-voice")
async def custom_voice(
    text: str = Form(...),
    language: str = Form("Auto"),
    speaker: str = Form("Ryan"),
    instruct: str = Form(""),
    model: str = Form("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"),
):
    # 9 speaker premium README: Vivian, Serena, Uncle_Fu, Dylan, Eric,
    # Ryan, Aiden, Ono_Anna, Sohee.
    try:
        tts = get_model(model)
        wavs, sr = tts.generate_custom_voice(
            text=text, language=language, speaker=speaker, instruct=instruct or None
        )
        return {"audio_url": save_wav(wavs, sr), "speaker": speaker}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"generate_custom_voice gagal: {e}") from e


@app.post("/api/voice-design")
async def voice_design(
    text: str = Form(...),
    language: str = Form("Auto"),
    instruct: str = Form(...),
    model: str = Form("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"),
):
    if not instruct.strip():
        raise HTTPException(400, "instruct (deskripsi suara) wajib diisi.")
    try:
        tts = get_model(model)
        wavs, sr = tts.generate_voice_design(text=text, language=language, instruct=instruct)
        return {"audio_url": save_wav(wavs, sr)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"generate_voice_design gagal: {e}") from e


@app.get("/outputs/{name}")
def output_file(name: str):
    path = OUTPUTS_DIR / name
    if not path.exists():
        raise HTTPException(404, "File tidak ditemukan.")
    return FileResponse(path, media_type="audio/wav", filename=name)


@app.get("/api/voices")
def list_voices():
    return {"voices": sorted(p.name for p in VOICES_DIR.glob("ref-*"))}


if __name__ == "__main__":
    import uvicorn

    print(f"Qwen Voice backend lokal — model default {DEFAULT_MODEL}")
    print(f"Buka aplikasi Next.js, pilih mode Lokal, isi backend: http://127.0.0.1:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)

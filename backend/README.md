# Backend lokal Qwen3-TTS (PC dengan GPU)

Backend ini menjalankan model open-weight Qwen3-TTS asli (`qwen-tts` dari
QwenLM/Qwen3-TTS) di komputer Bapak sendiri. Tidak dipakai oleh deployment
Vercel — Vercel tidak punya GPU.

## Syarat

- PC Windows / Linux dengan GPU NVIDIA + CUDA
- Python 3.12
- RAM GPU cukup: 0.6B-Base paling ringan; 1.7B-Base kualitas terbaik

## Jalankan

```bash
cd backend
pip install -r requirements.txt
python server.py
# -> http://127.0.0.1:8001/health
```

Bobot model (`Qwen/Qwen3-TTS-12Hz-0.6B-Base` default) diunduh otomatis dari
Hugging Face saat pertama dipakai. Ganti model lewat env:

```bash
QWEN_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base python server.py
```

## Pakai dari aplikasi web

1. Buka aplikasi, pilih mode **Lokal Qwen3-TTS**.
2. Isi URL backend (default `http://127.0.0.1:8001`).
3. Unggah audio referensi + isi transkrip persisnya (atau centang mode
   x-vector saja), tulis teks, Generate.

## Endpoint

- `GET /health` — status, CUDA, model yang termuat
- `POST /api/clone` — `generate_voice_clone` (ref_audio + ref_text + text)
- `POST /api/custom-voice` — `generate_custom_voice` (9 speaker premium)
- `POST /api/voice-design` — `generate_voice_design` (deskripsi suara)
- `GET /outputs/<file>` — hasil WAV

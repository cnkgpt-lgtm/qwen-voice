# Qwen Voice — Clone Suara Qwen3-TTS

Aplikasi web clone suara berbasis **Qwen3-TTS** (QwenLM/Qwen3-TTS, Apache-2.0)
dan **Qwen-Audio-TTS** (Alibaba Cloud Model Studio / DashScope).

![Next.js](https://img.shields.io/badge/Next.js-15-black) ![Vercel](https://img.shields.io/badge/Vercel-live-black)

## Cara kerja — dua mode

| Mode | Di mana jalan | Syarat |
| --- | --- | --- |
| **Cloud DashScope** (default) | Vercel | API key DashScope |
| **Lokal Qwen3-TTS** | PC dengan GPU | Backend Python di `backend/` |

Vercel tidak punya GPU, jadi model lokal Qwen3-TTS (`Qwen/Qwen3-TTS-12Hz-1.7B-Base`
dsb.) **tidak bisa** jalan di deployment Vercel. Jalur yang jalan di Vercel adalah
cloud DashScope — dan justru jalur inilah yang mendukung **Bahasa Indonesia**
(model lokal resmi hanya mencantumkan 10 bahasa: Mandarin, Inggris, Jepang, Korea,
Jerman, Prancis, Rusia, Portugis, Spanyol, Italia).

## Alur cloud (DashScope) — sesuai dokumentasi resmi

1. **Clone:** `POST {base}/services/audio/tts/customization` → `voice-enrollment`,
   `create_voice` dengan audio referensi (Data URI base64), `target_model`
   default `qwen-audio-3.1-tts-plus` → `voice_id` (status awal `DEPLOYING`).
2. **Cek status:** `query_voice` sampai `OK` (frontend mem-poll tiap 2 detik).
3. **Sintesis:** `POST {base}/services/audio/tts/SpeechSynthesizer` dengan `voice_id` itu →
   URL audio WAV (berlaku 24 jam).

Audio referensi cloud: WAV/MP3/M4A, maks 10 MB, disarankan 10–20 detik
(maks 60 detik), minimal 5 detik ucapan jelas. Suara hasil clone terikat ke
`target_model` dan tidak bisa dipakai di model lain.

Alur lokal memakai API Python persis dari README Qwen3-TTS:
`generate_voice_clone(text, language, ref_audio, ref_text, x_vector_only_mode)`,
`create_voice_clone_prompt`, `generate_custom_voice` (9 speaker: Vivian, Serena,
Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee), `generate_voice_design`.

## Menjalankan lokal (web)

```bash
npm install
npm run dev
# http://localhost:3000
```

## Deploy ke Vercel

Project ini terhubung ke repo ini; setiap push ke `main` men-deploy otomatis.
Env yang perlu diisi di Vercel → Settings → Environment Variables:

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | Ya, untuk Clone/Sintesis | Buat di bailian.console.aliyun.com → API-KEY |
| `DASHSCOPE_WORKSPACE_ID` | Tidak | Bila diisi, host API jadi `https://<ID>.cn-beijing.maas.aliyuncs.com/api/v1` |
| `DASHSCOPE_TARGET_MODEL` | Tidak | Default `qwen-audio-3.1-tts-plus` |
| `QWEN_LOCAL_BACKEND_URL` | Tidak | URL backend lokal, default `http://127.0.0.1:8001` |

Tanpa API key, aplikasi tetap bisa dibuka, tapi Clone & Sintesis meminta key —
key juga bisa diisi langsung di halaman Pengaturan aplikasi (tersimpan di
browser saja, tidak tersimpan di server).

## Backend lokal (PC GPU)

Lihat [`backend/README.md`](backend/README.md):

```bash
cd backend
pip install -r requirements.txt
python server.py
```

## Etika

Clone hanya suara sendiri atau suara yang Anda punya izin tertulisnya.
Jangan dipakai untuk meniru orang lain tanpa izin.

## Referensi

- QwenLM/Qwen3-TTS — https://github.com/QwenLM/Qwen3-TTS
- DashScope Qwen-TTS voice cloning — https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-cloning

import { NextRequest, NextResponse } from "next/server";
import {
  dashscopeBaseUrl,
  dashscopePost,
  getOutput,
  resolveApiKey,
  resolveTargetModel,
  resolveWorkspaceId,
} from "@/lib/dashscope";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/clone — multipart/form-data:
//   audio: File (WAV 16-bit / MP3 / M4A, maks 10 MB, disarankan 10-20 detik)
//   prefix: string (nama suara, dipakai sebagai prefix voice_id)
//   target_model: string (opsional)
// Header opsional: x-dashscope-key, x-dashscope-workspace
// Mengembalikan voice_id segera (status DEPLOYING); frontend mem-poll
// /api/voices/query sampai status OK. Ini disengaja agar tidak melewati
// batas durasi function serverless Vercel.
export async function POST(req: NextRequest) {
  const apiKey = resolveApiKey(req.headers.get("x-dashscope-key"));
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "API key DashScope belum diisi. Isi DASHSCOPE_API_KEY di env Vercel, atau isi API key di halaman Pengaturan aplikasi.",
      },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Form audio tidak terbaca." }, { status: 400 });
  }

  const file = form.get("audio");
  const prefixRaw = String(form.get("prefix") || "suara").trim() || "suara";
  const targetModel = resolveTargetModel(
    form.get("target_model") ? String(form.get("target_model")) : null,
  );

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File audio referensi wajib diunggah." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File audio maksimal 10 MB (aturan DashScope)." },
      { status: 400 },
    );
  }
  const allowed = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/webm"];
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (!allowed.includes(file.type) && !["wav", "mp3", "m4a"].includes(ext)) {
    return NextResponse.json(
      { error: "Format audio harus WAV, MP3, atau M4A." },
      { status: 400 },
    );
  }

  const prefix = prefixRaw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "suara";

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type.startsWith("audio/") ? file.type : "audio/wav";
  const audioDataUri = `data:${mime};base64,${buf.toString("base64")}`;

  const baseUrl = dashscopeBaseUrl(resolveWorkspaceId(req.headers.get("x-dashscope-workspace")));

  try {
    const data = await dashscopePost(baseUrl, apiKey, "/services/audio/tts/customization", {
      input: {
        action: "create_voice",
        audio: audioDataUri,
        prefix,
        target_model: targetModel,
      },
      model: "voice-enrollment",
    });
    const output = getOutput(data);
    const voiceId = String(output.voice_id || "");
    if (!voiceId) {
      return NextResponse.json(
        { error: "DashScope tidak mengembalikan voice_id.", raw: data },
        { status: 502 },
      );
    }
    return NextResponse.json({
      status: String(output.status || "DEPLOYING"),
      target_model: targetModel,
      voice_id: voiceId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menghubungi DashScope." },
      { status: 502 },
    );
  }
}

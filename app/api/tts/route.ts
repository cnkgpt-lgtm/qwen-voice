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

// POST /api/tts — JSON: { text, voice, target_model? }
// voice: voice_id hasil clone, atau nama suara bawaan DashScope (mis. "Cherry").
// Mengembalikan { audio_url } — URL audio WAV dari DashScope (berlaku 24 jam).
export async function POST(req: NextRequest) {
  const apiKey = resolveApiKey(req.headers.get("x-dashscope-key"));
  if (!apiKey) {
    return NextResponse.json(
      { error: "API key DashScope belum diisi. Isi di Pengaturan aplikasi atau env Vercel." },
      { status: 401 },
    );
  }

  let body: { text?: unknown; voice?: unknown; target_model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak terbaca." }, { status: 400 });
  }

  const text = String(body.text || "").trim();
  const voice = String(body.voice || "").trim();
  const targetModel = resolveTargetModel(
    body.target_model ? String(body.target_model) : null,
  );

  if (!text) return NextResponse.json({ error: "Teks wajib diisi." }, { status: 400 });
  if (text.length > 2000) {
    return NextResponse.json({ error: "Teks maksimal 2000 karakter per sintesis." }, { status: 400 });
  }
  if (!voice) return NextResponse.json({ error: "Voice wajib diisi (voice_id clone atau suara bawaan)." }, { status: 400 });

  const baseUrl = dashscopeBaseUrl(resolveWorkspaceId(req.headers.get("x-dashscope-workspace")));

  try {
    const data = await dashscopePost(baseUrl, apiKey, "/services/audio/tts/SpeechSynthesizer", {
      input: { format: "wav", sample_rate: 24000, text, voice },
      model: targetModel,
    });
    const output = getOutput(data);
    const audio = (output.audio as { url?: string } | undefined) || {};
    const audioUrl = String(audio.url || "");
    if (!audioUrl) {
      return NextResponse.json(
        { error: "DashScope tidak mengembalikan URL audio.", raw: data },
        { status: 502 },
      );
    }
    return NextResponse.json({ audio_url: audioUrl, target_model: targetModel, voice });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menghubungi DashScope." },
      { status: 502 },
    );
  }
}

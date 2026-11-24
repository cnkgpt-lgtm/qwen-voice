import { NextResponse } from "next/server";
import { DEFAULT_TARGET_MODEL } from "@/lib/dashscope";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    dashscope: {
      hasServerKey: Boolean((process.env.DASHSCOPE_API_KEY || "").trim()),
      hasWorkspaceId: Boolean((process.env.DASHSCOPE_WORKSPACE_ID || "").trim()),
      targetModel: (process.env.DASHSCOPE_TARGET_MODEL || DEFAULT_TARGET_MODEL).trim(),
    },
    localBackendUrl: (process.env.QWEN_LOCAL_BACKEND_URL || "").trim() || null,
    // Batas jujur: Vercel tidak punya GPU, jadi model lokal Qwen3-TTS
    // (Qwen/Qwen3-TTS-12Hz-1.7B-Base dsb.) TIDAK bisa jalan di sini.
    // Jalur yang jalan di Vercel adalah cloud DashScope; jalur lokal
    // memakai backend Python di PC bergrafik (lihat backend/README.md).
    modes: {
      cloud: "DashScope (Qwen-Audio-TTS) — jalan di Vercel, butuh API key",
      local: "Qwen3-TTS lokal (Base 0.6B/1.7B) — butuh PC dengan GPU + backend Python",
    },
    note: "Bahasa Indonesia didukung di jalur cloud Qwen-Audio-TTS. Di daftar resmi 10 bahasa model lokal Qwen3-TTS, Bahasa Indonesia tidak tercantum.",
  });
}

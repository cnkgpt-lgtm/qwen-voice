import { NextRequest, NextResponse } from "next/server";
import {
  dashscopeBaseUrl,
  dashscopePost,
  getOutput,
  resolveApiKey,
  resolveWorkspaceId,
} from "@/lib/dashscope";

export const runtime = "nodejs";

// GET /api/voices/query?voice_id=... — cek status clone:
// output.status: "OK" | "DEPLOYING" | "FAILED"
export async function GET(req: NextRequest) {
  const apiKey = resolveApiKey(req.headers.get("x-dashscope-key"));
  if (!apiKey) {
    return NextResponse.json({ error: "API key DashScope belum diisi." }, { status: 401 });
  }
  const voiceId = req.nextUrl.searchParams.get("voice_id") || "";
  if (!voiceId) {
    return NextResponse.json({ error: "voice_id wajib diisi." }, { status: 400 });
  }
  const baseUrl = dashscopeBaseUrl(resolveWorkspaceId(req.headers.get("x-dashscope-workspace")));
  try {
    const data = await dashscopePost(baseUrl, apiKey, "/services/audio/tts/customization", {
      input: { action: "query_voice", voice_id: voiceId },
      model: "voice-enrollment",
    });
    const output = getOutput(data);
    return NextResponse.json({
      status: String(output.status || "UNKNOWN"),
      voice_id: voiceId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menghubungi DashScope." },
      { status: 502 },
    );
  }
}

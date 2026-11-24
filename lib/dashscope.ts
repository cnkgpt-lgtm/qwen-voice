// Helper DashScope (Alibaba Cloud Model Studio) — Qwen-Audio-TTS voice cloning.
// Sumber: https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-cloning
// Alur resmi:
//   1. POST {base}/services/audio/tts/customization
//      { model: "voice-enrollment",
//        input: { action: "create_voice", target_model, prefix, audio: <URL publik | Data URI base64> } }
//      -> output.voice_id (status awal DEPLOYING)
//   2. POST endpoint yang sama { input: { action: "query_voice", voice_id } }
//      -> output.status: "OK" | "DEPLOYING" | "FAILED"
//   3. POST {base}/services/audio/tts/SpeechSynthesizer
//      { model: target_model,
//        input: { text, voice: voice_id, format: "wav", sample_rate: 24000 } }
//      -> output.audio.url (berlaku 24 jam)

export const DEFAULT_TARGET_MODEL = "qwen-audio-3.1-tts-plus";

export function dashscopeBaseUrl(workspaceId?: string | null): string {
  const ws = (workspaceId || process.env.DASHSCOPE_WORKSPACE_ID || "").trim();
  if (ws) return `https://${ws}.cn-beijing.maas.aliyuncs.com/api/v1`;
  return "https://dashscope.aliyuncs.com/api/v1";
}

export function resolveApiKey(headerKey?: string | null): string {
  const fromHeader = (headerKey || "").trim();
  if (fromHeader) return fromHeader;
  return (process.env.DASHSCOPE_API_KEY || "").trim();
}

export function resolveWorkspaceId(headerWs?: string | null): string {
  const fromHeader = (headerWs || "").trim();
  if (fromHeader) return fromHeader;
  return (process.env.DASHSCOPE_WORKSPACE_ID || "").trim();
}

export function resolveTargetModel(input?: string | null): string {
  const v = (input || "").trim();
  if (v) return v;
  return (process.env.DASHSCOPE_TARGET_MODEL || DEFAULT_TARGET_MODEL).trim();
}

export async function dashscopePost(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data as { message?: string }).message ||
      (data as { code?: string }).code ||
      text.slice(0, 500);
    throw new Error(`DashScope ${res.status}: ${msg}`);
  }
  return data;
}

export function getOutput(data: Record<string, unknown>): Record<string, unknown> {
  return (data.output as Record<string, unknown>) || {};
}

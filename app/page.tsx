"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "cloud" | "local";
type Status = {
  dashscope: { hasServerKey: boolean; hasWorkspaceId: boolean; targetModel: string };
  localBackendUrl: string | null;
  note: string;
} | null;

type Profile = { id: string; name: string; voice_id: string; target_model: string; created_at: string };
type HistoryItem = { id: string; text: string; voice: string; audio_url: string; created_at: string };

const LS_KEY = "qwen-voice:api-key";
const LS_WS = "qwen-voice:workspace";
const LS_PROFILES = "qwen-voice:profiles";
const LS_HISTORY = "qwen-voice:history";
const LS_MODE = "qwen-voice:mode";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function blobToWav(blob: Blob): Promise<Blob> {
  // Rekaman browser (WebM/Opus) tidak diterima DashScope (hanya WAV/MP3/M4A),
  // jadi decode lalu encode ulang ke WAV PCM 16-bit mono di browser.
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channel = buf.getChannelData(0);
    const data = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    v.setUint32(4, 36 + data.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, buf.sampleRate, true);
    v.setUint32(28, buf.sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, "data");
    v.setUint32(40, data.length * 2, true);
    return new Blob([header, data.buffer], { type: "audio/wav" });
  } finally {
    await ctx.close();
  }
}

export default function Home() {
  const [status, setStatus] = useState<Status>(null);
  const [tab, setTab] = useState<"clone" | "builtin" | "settings">("clone");
  const [mode, setMode] = useState<Mode>("cloud");
  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [targetModel, setTargetModel] = useState("qwen-audio-3.1-tts-plus");
  const [localBackendUrl, setLocalBackendUrl] = useState("http://127.0.0.1:8001");

  const [refFile, setRefFile] = useState<File | null>(null);
  const [refUrl, setRefUrl] = useState("");
  const [refDuration, setRefDuration] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [voiceName, setVoiceName] = useState("");
  const [refText, setRefText] = useState("");
  const [xvecOnly, setXvecOnly] = useState(false);
  const [localModel, setLocalModel] = useState("Qwen/Qwen3-TTS-12Hz-0.6B-Base");
  const [language, setLanguage] = useState("Auto");
  const [text, setText] = useState(
    "Halo, ini suara hasil clone Qwen3-TTS. Saya bisa membacakan teks apa pun dengan suara ini.",
  );
  const [builtinVoice, setBuiltinVoice] = useState("Cherry");

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [cloneStatus, setCloneStatus] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lastAudio, setLastAudio] = useState("");

  useEffect(() => {
    setApiKey(localStorage.getItem(LS_KEY) || "");
    setWorkspaceId(localStorage.getItem(LS_WS) || "");
    setProfiles(load<Profile[]>(LS_PROFILES, []));
    setHistory(load<HistoryItem[]>(LS_HISTORY, []));
    setMode((localStorage.getItem(LS_MODE) as Mode) || "cloud");
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => {
        setStatus(s as Status);
        if (s?.dashscope?.targetModel) setTargetModel(s.dashscope.targetModel);
        if (s?.localBackendUrl) setLocalBackendUrl(s.localBackendUrl);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_MODE, mode);
  }, [mode]);

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (apiKey.trim()) h["x-dashscope-key"] = apiKey.trim();
    if (workspaceId.trim()) h["x-dashscope-workspace"] = workspaceId.trim();
    return h;
  }, [apiKey, workspaceId]);

  const onPickFile = (f: File | null) => {
    setRefFile(f);
    setRefDuration(null);
    if (refUrl) URL.revokeObjectURL(refUrl);
    if (!f) {
      setRefUrl("");
      return;
    }
    const url = URL.createObjectURL(f);
    setRefUrl(url);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => setRefDuration(audio.duration);
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimer.current) clearInterval(recTimer.current);
        setRecording(false);
        try {
          const wav = await blobToWav(new Blob(chunks));
          const file = new File([wav], `rekaman-${Date.now()}.wav`, { type: "audio/wav" });
          onPickFile(file);
          setInfo("Rekaman diubah ke WAV dan siap dipakai sebagai referensi.");
        } catch {
          setError("Rekaman tidak bisa diubah ke WAV. Coba unggah file WAV/MP3 saja.");
        }
      };
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      recTimer.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      setError("Mikrofon tidak bisa diakses. Izinkan akses mikrofon, atau unggah file audio.");
    }
  };

  const stopRecording = () => mediaRef.current?.stop();

  const saveProfiles = (list: Profile[]) => {
    setProfiles(list);
    localStorage.setItem(LS_PROFILES, JSON.stringify(list));
  };

  const pushHistory = (item: HistoryItem) => {
    const list = [item, ...history].slice(0, 20);
    setHistory(list);
    localStorage.setItem(LS_HISTORY, JSON.stringify(list));
  };

  const pollClone = async (voiceId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`/api/voices/query?voice_id=${encodeURIComponent(voiceId)}`, {
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengecek status suara.");
      setCloneStatus(`Status clone: ${data.status} (cek ke-${i + 1})`);
      if (data.status === "OK") return;
      if (data.status === "FAILED") throw new Error("Clone gagal di DashScope (status FAILED). Coba audio lain yang lebih jernih.");
    }
    throw new Error("Suara masih DEPLOYING setelah 60 detik. Simpan voice_id-nya dan cek lagi nanti.");
  };

  const doCloneCloud = async () => {
    if (!refFile) {
      setError("Unggah atau rekam dulu audio referensi (disarankan 10-20 detik, maks 60 detik, maks 10 MB).");
      return;
    }
    if (!voiceName.trim()) {
      setError("Isi dulu nama suara (mis. suara-bapak).");
      return;
    }
    setError("");
    setInfo("");
    setBusy("clone");
    setCloneStatus("Mengunggah audio ke DashScope…");
    try {
      const form = new FormData();
      form.append("audio", refFile);
      form.append("prefix", voiceName.trim());
      form.append("target_model", targetModel);
      const res = await fetch("/api/clone", { body: form, headers: headers(), method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clone gagal.");
      setCloneStatus(`voice_id didapat: ${data.voice_id}. Menunggu deployment…`);
      await pollClone(data.voice_id as string);
      const profile: Profile = {
        created_at: new Date().toISOString(),
        id: data.voice_id as string,
        name: voiceName.trim(),
        target_model: targetModel,
        voice_id: data.voice_id as string,
      };
      saveProfiles([profile, ...profiles.filter((p) => p.voice_id !== profile.voice_id)]);
      setSelectedVoice(profile.voice_id);
      setCloneStatus("");
      setInfo(`Suara "${profile.name}" berhasil di-clone dan siap dipakai. voice_id: ${profile.voice_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clone gagal.");
    } finally {
      setBusy("");
    }
  };

  const doCloneLocal = async () => {
    if (!refFile) {
      setError("Unggah atau rekam dulu audio referensi.");
      return;
    }
    if (!xvecOnly && !refText.trim()) {
      setError("Untuk mode lokal, isi transkrip audio referensi — kecuali centang mode x-vector saja.");
      return;
    }
    if (!text.trim()) {
      setError("Isi dulu teks yang mau dibacakan.");
      return;
    }
    setError("");
    setInfo("");
    setBusy("clone-local");
    try {
      const form = new FormData();
      form.append("ref_audio", refFile);
      form.append("ref_text", refText);
      form.append("text", text);
      form.append("language", language);
      form.append("model", localModel);
      form.append("x_vector_only_mode", String(xvecOnly));
      const base = localBackendUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/api/clone`, { body: form, method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Backend lokal gagal.");
      const audioUrl = `${base}${data.audio_url as string}`;
      setLastAudio(audioUrl);
      pushHistory({ audio_url: audioUrl, created_at: new Date().toISOString(), id: `${Date.now()}`, text, voice: "lokal: referensi langsung" });
      setInfo("Audio hasil clone lokal selesai. Putar atau unduh di bawah.");
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — Pastikan backend Python jalan di ${localBackendUrl} (lihat backend/README.md).`
          : "Backend lokal gagal.",
      );
    } finally {
      setBusy("");
    }
  };

  const doSynthCloud = async (voice: string, useText?: string) => {
    const t = (useText ?? text).trim();
    if (!t) {
      setError("Isi dulu teks yang mau dibacakan.");
      return;
    }
    if (!voice) {
      setError("Pilih dulu suara hasil clone, atau isi suara bawaan.");
      return;
    }
    setError("");
    setInfo("");
    setBusy("tts");
    try {
      const res = await fetch("/api/tts", {
        body: JSON.stringify({ target_model: targetModel, text: t, voice }),
        headers: { ...headers(), "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sintesis gagal.");
      setLastAudio(data.audio_url as string);
      pushHistory({
        audio_url: data.audio_url as string,
        created_at: new Date().toISOString(),
        id: `${Date.now()}`,
        text: t,
        voice,
      });
      setInfo("Audio selesai dibuat.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sintesis gagal.");
    } finally {
      setBusy("");
    }
  };

  const saveSettings = () => {
    localStorage.setItem(LS_KEY, apiKey.trim());
    localStorage.setItem(LS_WS, workspaceId.trim());
    setInfo("Pengaturan disimpan di browser ini saja. API key tidak dikirim ke mana pun kecuali ke DashScope lewat server aplikasi ini.");
  };

  return (
    <div className="wrap">
      <header className="hero">
        <span className="badge">Qwen3-TTS • Qwen-Audio-TTS</span>
        <span className="badge">Clone suara</span>
        <span className="badge">Bahasa Indonesia didukung (jalur cloud)</span>
        <h1>Qwen Voice — Clone Suara</h1>
        <p>
          Unggah atau rekam suara referensi, clone menjadi suara baru, lalu bacakan teks apa pun
          dengan suara itu. Referensi: QwenLM/Qwen3-TTS (Apache-2.0) — model Base clone dari audio
          3 detik; jalur cloud DashScope memakai audio 10–20 detik.
        </p>
      </header>

      <div className="statusbar">
        <span>
          <span className={`dot ${status?.dashscope.hasServerKey ? "ok" : "warn"}`} />
          API key server: {status ? (status.dashscope.hasServerKey ? "terpasang" : "belum diisi") : "memeriksa…"}
        </span>
        <span>
          <span className={`dot ${apiKey.trim() ? "ok" : "warn"}`} />
          API key di browser: {apiKey.trim() ? "terisi" : "kosong"}
        </span>
        <span className="muted">Model cloud: {targetModel}</span>
      </div>

      {!status?.dashscope.hasServerKey && !apiKey.trim() && (
        <div className="alert warn">
          Belum ada API key DashScope, jadi tombol Clone &amp; Sintesis akan meminta key.
          Isi di tab Pengaturan (disimpan di browser saja), atau set <code className="inline">DASHSCOPE_API_KEY</code> di
          env Vercel. Tanpa key, aplikasi tetap bisa dibuka dan dicoba alurnya sampai titik itu.
        </div>
      )}

      <div className="card">
        <label>Mode</label>
        <div className="btnrow" style={{ marginTop: 0 }}>
          <button className={`btn ${mode === "cloud" ? "" : "ghost"}`} onClick={() => setMode("cloud")}>
            Cloud DashScope — jalan di Vercel
          </button>
          <button className={`btn ${mode === "local" ? "" : "ghost"}`} onClick={() => setMode("local")}>
            Lokal Qwen3-TTS — PC dengan GPU
          </button>
        </div>
        <p className="muted">
          {mode === "cloud"
            ? "Mode cloud memakai API Alibaba Model Studio. Suara hasil clone terikat ke model target dan tidak bisa dipakai di model lain. Biaya mengikuti tarif DashScope."
            : "Mode lokal memakai model open-weight Qwen3-TTS-12Hz-Base langsung (generate_voice_clone). Butuh PC dengan GPU dan backend Python di folder backend/. Vercel tidak punya GPU, jadi mode ini tidak jalan di deployment Vercel."}
        </p>
      </div>

      <div className="tabs">
        <button className={tab === "clone" ? "active" : ""} onClick={() => setTab("clone")}>1 • Clone Suara</button>
        <button className={tab === "builtin" ? "active" : ""} onClick={() => setTab("builtin")}>2 • Suara Bawaan</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Pengaturan &amp; Panduan</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert ok">{info}</div>}
      {cloneStatus && <div className="alert info">{cloneStatus}</div>}

      {tab === "clone" && (
        <>
          <div className="card">
            <h2>Langkah 1 — Audio referensi</h2>
            <p className="muted">
              {mode === "cloud"
                ? "WAV / MP3 / M4A, maks 10 MB, disarankan 10–20 detik (maks 60 detik), minimal 5 detik ucapan jelas tanpa musik dan tanpa suara orang lain. Bahasa Indonesia didukung."
                : "Audio jernih, disarankan 3 detik atau lebih (model Base Qwen3-TTS). Isi juga transkrip persis audio itu di bawah."}
              Hanya clone suara sendiri atau suara yang Bapak punya izinnya.
            </p>
            <div className="btnrow">
              <label className="btn ghost" style={{ margin: 0 }}>
                Unggah audio
                <input
                  accept=".wav,.mp3,.m4a,audio/*"
                  hidden
                  onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              {!recording ? (
                <button className="btn ghost" onClick={startRecording}>● Rekam suara</button>
              ) : (
                <button className="btn danger" onClick={stopRecording}>
                  <span className="rec-dot" /> Berhenti ({recSeconds} dtk)
                </button>
              )}
              {refFile && (
                <button className="btn ghost" onClick={() => onPickFile(null)}>Hapus</button>
              )}
            </div>
            {refFile && (
              <>
                <p className="muted">
                  {refFile.name} — {(refFile.size / 1024).toFixed(0)} KB
                  {refDuration ? ` — durasi ${refDuration.toFixed(1)} detik` : ""}
                </p>
                <audio controls src={refUrl} />
              </>
            )}
            <div className="row">
              <div>
                <label>Nama suara</label>
                <input onChange={(e) => setVoiceName(e.target.value)} placeholder="mis. suara-bapak" type="text" value={voiceName} />
              </div>
              {mode === "cloud" ? (
                <div>
                  <label>Model target (cloud)</label>
                  <input onChange={(e) => setTargetModel(e.target.value)} type="text" value={targetModel} />
                </div>
              ) : (
                <div>
                  <label>Model lokal</label>
                  <select onChange={(e) => setLocalModel(e.target.value)} value={localModel}>
                    <option value="Qwen/Qwen3-TTS-12Hz-0.6B-Base">0.6B-Base — ringan, rekomendasi</option>
                    <option value="Qwen/Qwen3-TTS-12Hz-1.7B-Base">1.7B-Base — kualitas terbaik, butuh GPU besar</option>
                  </select>
                </div>
              )}
            </div>
            {mode === "local" && (
              <>
                <label>Transkrip audio referensi (wajib, kecuali mode x-vector)</label>
                <textarea onChange={(e) => setRefText(e.target.value)} placeholder="Tulis persis apa yang diucapkan di audio referensi…" value={refText} />
                <label style={{ fontWeight: 400 }}>
                  <input checked={xvecOnly} onChange={(e) => setXvecOnly(e.target.checked)} type="checkbox" />{" "}
                  Mode x-vector saja (tanpa transkrip, kualitas clone bisa turun — sesuai README Qwen3-TTS)
                </label>
              </>
            )}
            <div className="btnrow">
              <button
                className="btn"
                disabled={busy !== ""}
                onClick={mode === "cloud" ? doCloneCloud : doCloneLocal}
              >
                {busy === "clone" || busy === "clone-local"
                  ? "Memproses…"
                  : mode === "cloud"
                    ? "Clone suara ini"
                    : "Generate dengan suara referensi"}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Langkah 2 — Teks &amp; sintesis</h2>
            {mode === "local" && (
              <div className="row">
                <div>
                  <label>Bahasa teks (lokal)</label>
                  <select onChange={(e) => setLanguage(e.target.value)} value={language}>
                    {["Auto", "English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"].map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                  <p className="muted">Bahasa Indonesia tidak ada di daftar resmi 10 bahasa model lokal — pakai Auto.</p>
                </div>
                <div>
                  <label>Backend lokal</label>
                  <input onChange={(e) => setLocalBackendUrl(e.target.value)} type="text" value={localBackendUrl} />
                </div>
              </div>
            )}
            <label>Teks yang dibacakan</label>
            <textarea maxLength={2000} onChange={(e) => setText(e.target.value)} value={text} />
            <p className="muted">{text.length}/2000 karakter.</p>
            {mode === "cloud" && (
              <>
                <label>Pilih suara hasil clone</label>
                {profiles.length === 0 ? (
                  <p className="muted">Belum ada suara hasil clone. Selesaikan Langkah 1 dulu — suara tersimpan di browser ini.</p>
                ) : (
                  profiles.map((p) => (
                    <div className="voice" key={p.voice_id}>
                      <span>
                        <strong>{p.name}</strong> — <code>{p.voice_id}</code>
                        <br /><span className="muted">{p.target_model} • {new Date(p.created_at).toLocaleString("id-ID")}</span>
                      </span>
                      <button className={`btn ${selectedVoice === p.voice_id ? "" : "ghost"}`} onClick={() => setSelectedVoice(p.voice_id)}>
                        {selectedVoice === p.voice_id ? "Dipilih" : "Pilih"}
                      </button>
                    </div>
                  ))
                )}
                <div className="btnrow">
                  <button className="btn" disabled={busy !== "" || !selectedVoice} onClick={() => doSynthCloud(selectedVoice)}>
                    {busy === "tts" ? "Membuat audio…" : "Bacakan dengan suara ini"}
                  </button>
                </div>
              </>
            )}
            {mode === "local" && (
              <div className="btnrow">
                <button className="btn" disabled={busy !== ""} onClick={doCloneLocal}>
                  {busy === "clone-local" ? "Meng-generate…" : "Generate dengan suara referensi"}
                </button>
              </div>
            )}
            {lastAudio && (
              <>
                <h3>Hasil terakhir</h3>
                <audio controls src={lastAudio} />
                <div className="btnrow">
                  <a className="btn ghost" download href={lastAudio}>Unduh WAV</a>
                </div>
              </>
            )}
            {history.length > 0 && (
              <>
                <h3>Riwayat (browser ini)</h3>
                {history.map((h) => (
                  <div className="voice" key={h.id}>
                    <span>
                      {h.text.slice(0, 80)}{h.text.length > 80 ? "…" : ""}
                      <br /><span className="muted">{h.voice} • {new Date(h.created_at).toLocaleString("id-ID")}</span>
                    </span>
                    <a className="btn ghost" href={h.audio_url} target="_blank" rel="noreferrer">Putar / Unduh</a>
                  </div>
                ))}
                <button className="btn ghost" onClick={() => { setHistory([]); localStorage.removeItem(LS_HISTORY); }}>Hapus riwayat</button>
              </>
            )}
          </div>
        </>
      )}

      {tab === "builtin" && (
        <div className="card">
          <h2>Suara bawaan DashScope</h2>
          <p className="muted">
            Tanpa clone, Bapak bisa langsung memakai suara bawaan DashScope. Isi nama voice-nya
            (contoh yang terdokumentasi untuk Qwen3-TTS: <code className="inline">Cherry</code>).
            Daftar lengkap suara ada di dokumentasi Model Studio — ketik nama persisnya di sini.
          </p>
          <label>Nama suara bawaan</label>
          <input onChange={(e) => setBuiltinVoice(e.target.value)} type="text" value={builtinVoice} />
          <label>Teks</label>
          <textarea maxLength={2000} onChange={(e) => setText(e.target.value)} value={text} />
          <div className="btnrow">
            <button className="btn" disabled={busy !== ""} onClick={() => doSynthCloud(builtinVoice)}>
              {busy === "tts" ? "Membuat audio…" : "Bacakan dengan suara bawaan"}
            </button>
          </div>
          {lastAudio && (
            <>
              <h3>Hasil terakhir</h3>
              <audio controls src={lastAudio} />
              <div className="btnrow">
                <a className="btn ghost" download href={lastAudio}>Unduh WAV</a>
              </div>
            </>
          )}
          <h3>Suara kustom lokal (9 preset Qwen3-TTS)</h3>
          <p className="muted">
            Di mode lokal, model <code className="inline">Qwen3-TTS-12Hz-1.7B/0.6B-CustomVoice</code> punya
            9 suara premium: Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee —
            lengkap dengan kontrol instruksi gaya bicara. Itu tersedia lewat backend Python
            (<code className="inline">POST /api/custom-voice</code> di <code className="inline">backend/server.py</code>),
            belum ada UI-nya di halaman ini.
          </p>
        </div>
      )}

      {tab === "settings" && (
        <>
          <div className="card">
            <h2>Pengaturan</h2>
            <label>API key DashScope (disimpan di browser saja)</label>
            <input onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." type="password" value={apiKey} />
            <label>Workspace ID (opsional, region Beijing)</label>
            <input onChange={(e) => setWorkspaceId(e.target.value)} placeholder="kosongkan bila tidak tahu" type="text" value={workspaceId} />
            <label>Model target default</label>
            <input onChange={(e) => setTargetModel(e.target.value)} type="text" value={targetModel} />
            <label>URL backend lokal (mode Lokal)</label>
            <input onChange={(e) => setLocalBackendUrl(e.target.value)} type="text" value={localBackendUrl} />
            <div className="btnrow">
              <button className="btn" onClick={saveSettings}>Simpan pengaturan</button>
              <button className="btn ghost" onClick={() => { setApiKey(""); localStorage.removeItem(LS_KEY); setInfo("API key di browser dihapus."); }}>Hapus API key</button>
            </div>
            <p className="muted">
              Bila API key diisi di env Vercel (<code className="inline">DASHSCOPE_API_KEY</code>), semua
              pengunjung memakai key itu. Bila diisi di sini, key hanya ada di browser Bapak dan
              dikirim ke server aplikasi ini untuk diteruskan ke DashScope.
            </p>
          </div>
          <div className="card">
            <h2>Panduan singkat</h2>
            <ol className="steps">
              <li>Buat API key di Alibaba Cloud Model Studio (bailian.console.aliyun.com → API-KEY → Create API Key). Layanan ini berbayar mengikuti pemakaian.</li>
              <li>Isi key di tab ini, atau set <code className="inline">DASHSCOPE_API_KEY</code> di Vercel → Project → Settings → Environment Variables, lalu redeploy.</li>
              <li>Tab Clone: unggah/rekam audio 10–20 detik → isi nama suara → Clone → tunggu status OK → tulis teks → Bacakan.</li>
              <li>Mode Lokal (PC GPU): <code className="inline">cd backend && pip install -r requirements.txt && python server.py</code>, lalu isi URL backend di atas. Model 0.6B-Base diunduh otomatis dari Hugging Face saat pertama dipakai.</li>
              <li>Demo resmi Qwen3-TTS (Gradio) juga bisa dijalankan dari repo aslinya: <code className="inline">pip install qwen-tts && qwen-tts-demo Qwen/Qwen3-TTS-12Hz-1.7B-Base --port 8000</code>.</li>
            </ol>
            <h3>Batas yang perlu diketahui</h3>
            <ul className="steps">
              <li>Vercel tidak punya GPU — model Qwen3-TTS lokal tidak bisa jalan di deployment ini.</li>
              <li>Suara clone terikat ke model target; ganti model berarti clone ulang.</li>
              <li>Audio referensi cloud: maks 10 MB / 60 detik, WAV/MP3/M4A, minimal 5 detik ucapan jelas.</li>
              <li>Clone hanya suara sendiri atau yang Bapak punya izin tertulisnya.</li>
            </ul>
          </div>
        </>
      )}

      <footer>
        Referensi: github.com/QwenLM/Qwen3-TTS (Apache-2.0) dan dokumentasi Alibaba Cloud Model Studio
        (Qwen-TTS voice cloning). Repo aplikasi ini: github.com/cnkgpt-lgtm/qwen-voice.
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Clone suara dengan Qwen3-TTS / Qwen-Audio-TTS (DashScope cloud) dan backend lokal Qwen3-TTS untuk PC GPU.",
  title: "Qwen Voice — Clone Suara Qwen3-TTS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API route /api/clone menerima upload audio sampai 10 MB.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;

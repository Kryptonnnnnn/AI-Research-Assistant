import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Docker image sets NEXT_STANDALONE=1; Vercel / `next start` use the default output.
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  async rewrites() {
    // Same-origin proxy so the httpOnly session cookie works with a separately hosted API.
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;

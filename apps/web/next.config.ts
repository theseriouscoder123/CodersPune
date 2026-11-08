import type { NextConfig } from "next";

// Where the FastAPI app lives. Locally: uvicorn on :8000. In production: the API Vercel project's URL.
// The browser only ever calls same-origin /api/*, so cookies stay first-party and no CORS is needed (DECISIONS D8).
const API_ORIGIN = (process.env.API_ORIGIN ?? "http://localhost:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// Where the FastAPI app lives. Locally: uvicorn on :8000. In production: the API Vercel project's URL.
// The browser only ever calls same-origin /api/*, so cookies stay first-party and no CORS is needed (DECISIONS D8).
const API_ORIGIN = (process.env.API_ORIGIN ?? "http://localhost:8000").replace(/\/$/, "");

const isProd = process.env.NODE_ENV === "production";

// Fonts are self-hosted by next/font and every API call is same-origin, so the policy can stay tight.
// 'unsafe-inline' scripts: Next's inline bootstrap + the tiny theme script that prevents a dark-mode flash.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

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
  async headers() {
    return [
      // everything except the API reference gets the strict policy
      { source: "/:path((?!api/docs).*)", headers: SECURITY_HEADERS },
      // the API reference (FastAPI's Swagger UI) loads its assets from jsDelivr
      { source: "/api/docs", headers: [...SECURITY_HEADERS.filter((h) => h.key !== "Content-Security-Policy"), { key: "Content-Security-Policy", value: DOCS_CSP }] },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

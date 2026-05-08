import type { NextConfig } from "next";
import withBundleAnalyzerImport from "@next/bundle-analyzer";

// v1.80.6 — phase 4 perf: opt-in bundle analyzer.
//   Turbopack (Next 16 default) is incompatible with the webpack-based
//   @next/bundle-analyzer plugin — `ANALYZE=true npx next build` warns
//   and skips report generation. For Turbopack analysis use
//   `npx next experimental-analyze` directly — that writes a treemap
//   under `.next/diagnostics/analyze/` (open `index.html` from a static
//   file server). The wrapper below is preserved as a webpack-fallback
//   path: pass `--webpack` to next build alongside `ANALYZE=true` to opt
//   out of Turbopack and generate the classic webpack-bundle-analyzer
//   HTML. Default behavior (no env var) is unchanged — no-op wrapper.
const withBundleAnalyzer = withBundleAnalyzerImport({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // v1.71.1 — `bodySizeLimit` no longer drives ID-upload behavior.
  // Pre-v1.71.1 the /recruit/[slug] + /join/[code]/onboarding forms
  // shipped FormData multipart bodies up to 21MB through the server
  // action; the v1.62.0 → v1.69.1 chain bumped this limit (1mb → 6mb
  // → 25mb) trying to fit them. The Next.js setting was ineffective:
  // Vercel's edge layer caps serverless function request bodies at
  // ~4.5MB and rejects oversize requests with HTTP 413
  // (FUNCTION_PAYLOAD_TOO_LARGE) BEFORE the function runs.
  //
  // v1.71.1 routes the bytes around the function: files upload
  // client-direct to Vercel Blob via `@vercel/blob/client#upload`; the
  // server actions now receive only the resulting URLs (a few KB).
  // The Next.js framework limit still gates JSON-shaped server-action
  // payloads, but those are tiny — 2mb is plenty.
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      {
        // LINE profile picture CDN
        protocol: "https",
        hostname: "profile.line-scdn.net",
      },
      {
        // Vercel Blob storage (player profile pictures)
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/minato",
        destination:
          "https://www.appsheet.com/start/e93876c1-61c8-42a4-aadb-e83ce9f606a5",
        permanent: false,
      },
      {
        source: "/shinagawa",
        destination:
          "https://www.appsheet.com/start/1879dbe2-b025-488c-86a9-87eb9b6bcd0c",
        permanent: false,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);

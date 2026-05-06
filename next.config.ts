import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // v1.62.0 — raise the server-action body limit. Default is 1MB; uploads
  // above the limit hit the framework's body-limit error and surface as
  // "An unexpected response was received from the server" before our own
  // validation can run.
  //
  // v1.69.1 — raised again from 6MB → 25MB. The v1.68.0 /recruit/[slug]
  // and /join/[code]/onboarding forms upload up to 8MB ID front + 8MB ID
  // back + 5MB optional profile picture = 21MB per submission. Any single
  // file above 6MB (or two files together) blew through the v1.62.0 limit
  // and surfaced the same "unexpected response" error users saw before.
  // 25MB covers the 21MB payload plus multipart/FormData overhead.
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
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

export default nextConfig;

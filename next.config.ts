import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // v1.62.0 — raise the server-action body limit. Default is 1MB; the
  // /account/player profile-picture upload claims a 5MB max, so files
  // between 1MB and 5MB hit the framework's body-limit error and surface
  // as "An unexpected response was received from the server" before our
  // own validation can run. 6MB gives FormData overhead headroom.
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
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

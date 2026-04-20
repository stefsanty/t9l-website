import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

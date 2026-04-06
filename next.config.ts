import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/minato",
        destination:
          "https://www.appsheet.com/start/e93876c1-61c8-42a4-aadb-e83ce9f606a5",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

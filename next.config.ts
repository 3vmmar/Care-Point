import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Static clinic assets are served directly. The deployment does not need
    // the optional Cloudflare image-transform binding for these local files.
    unoptimized: true,
  },
};

export default nextConfig;

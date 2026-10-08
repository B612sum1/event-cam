import type { NextConfig } from "next";

// このアプリはほぼすべての画面がクライアント側で Supabase と直接通信する構成のため、
// create-next-app が既定で有効にする cacheComponents / partialPrefetching は使わない。
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

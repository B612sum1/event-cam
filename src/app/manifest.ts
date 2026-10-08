import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Event Cam｜みんなで撮って、あとで現像",
    short_name: "Event Cam",
    description: "結婚式・イベント向けの共有インスタントカメラ",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f0e6",
    theme_color: "#171412",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

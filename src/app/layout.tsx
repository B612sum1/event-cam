import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Event Cam｜配って、撮って、あとで現像",
    template: "%s｜Event Cam",
  },
  description:
    "結婚式やパーティーで、ゲストのスマホを使い捨てカメラに。撮った写真は、決めた時間にまとめて現像されます。",
  applicationName: "Event Cam",
  appleWebApp: {
    capable: true,
    title: "Event Cam",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

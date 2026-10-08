import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Event Cam｜みんなで撮って、あとで現像",
    template: "%s｜Event Cam",
  },
  description:
    "結婚式やパーティーで、ゲストのスマホがインスタントカメラに。撮った写真は指定した時刻に一斉に現像・公開されます。",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f0e6" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1613" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

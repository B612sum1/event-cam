"use client";

import { QRCodeSVG } from "qrcode.react";

type Props = {
  value: string;
  size?: number;
  className?: string;
};

/**
 * 参加用 QR コード。印刷しても潰れないよう SVG で描画し、
 * テーブルの照明が暗くても読めるよう誤り訂正レベルは M、余白（quiet zone）付き。
 */
export function QRCodeDisplay({ value, size = 220, className }: Props) {
  return (
    <div className={`inline-block rounded-2xl bg-white p-4 shadow-sm ${className ?? ""}`}>
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        marginSize={1}
        bgColor="#ffffff"
        fgColor="#171412"
        title="イベント参加用QRコード"
      />
    </div>
  );
}

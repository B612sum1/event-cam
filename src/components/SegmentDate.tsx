import { formatFilmDate, segmentLines } from "@/lib/utils/filmEffect";

type Props = {
  date: Date;
  /** 数字1文字の高さ(px) */
  height?: number;
  className?: string;
};

/**
 * 使い捨てカメラの日付LCD（7セグメント）。写真に焼き込む日付と同じ形を SVG で描く。
 */
export function SegmentDate({ date, height = 22, className = "" }: Props) {
  const text = formatFilmDate(date);
  const { lines, width } = segmentLines(text);
  const pad = 0.5;
  return (
    <svg
      className={className}
      width={((width + pad * 2) * height) / 2}
      height={((2 + pad) * height) / 2}
      viewBox={`${-pad} ${-pad / 2} ${width + pad * 2} ${2 + pad}`}
      role="img"
      aria-label={`日付 ${text}`}
      style={{ filter: "drop-shadow(0 0 3px rgb(230 140 10 / 0.8)) drop-shadow(0 0 1px rgb(240 170 30 / 0.85))", overflow: "visible" }}
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {lines.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(246 206 82)" strokeWidth={0.2} />
        ))}
      </g>
    </svg>
  );
}

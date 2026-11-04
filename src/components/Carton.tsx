/** ロゴ・外箱の帯・「◯枚撮り」シール */

type WordmarkProps = {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** dark：黒い画面の上 / light：紙（外箱・印刷物）の上 */
  tone?: "dark" | "light";
};

export function Wordmark({ className = "", size = "sm", tone = "dark" }: WordmarkProps) {
  const text = { xs: "text-[15px]", sm: "text-lg", md: "text-2xl", lg: "text-[clamp(44px,13vw,88px)]" }[size];
  return (
    <span className={`cond inline-flex items-baseline leading-none italic ${text} ${className}`} aria-label="Event Cam">
      <span>EVENT</span>
      <span className={`ml-[0.22em] ${tone === "dark" ? "text-teal-light" : "text-teal"}`}>CAM</span>
    </span>
  );
}

export function CartonStripes({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-[3px] ${className}`} aria-hidden>
      <div className="h-2 bg-teal" />
      <div className="h-[3px] bg-tomato" />
    </div>
  );
}

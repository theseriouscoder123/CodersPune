import { ImageResponse } from "next/og";

export const alt = "Baton: evidence-graded knowledge handovers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATUSES: [string, string][] = [["Verified", "#1a7f37"], ["Supported", "#1a7f37"], ["Inferred", "#6e7781"], ["Conflicting", "#bc4c00"], ["Missing", "#cf222e"]];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "#ffffff", padding: "64px 72px", color: "#191918", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#191918" />
            <rect x="7.5" y="13.9" width="17" height="4.2" rx="2.1" fill="#ffffff" transform="rotate(-30 16 16)" />
            <circle cx="23.2" cy="11.8" r="2" fill="#0b6bde" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Baton</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 1000 }}>When someone leaves, keep the reasoning, not just the files.</div>
          <div style={{ fontSize: 28, color: "#6a6a66", maxWidth: 980, lineHeight: 1.4 }}>
            Every claim cites its exact source. Statuses come from rules. The successor sees only what they&apos;re allowed to.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 22 }}>
          {STATUSES.map(([t, c]) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 8, border: "1px solid #e8e8e5", color: "#191918", fontWeight: 600 }}>
              <div style={{ width: 12, height: 12, borderRadius: 999, background: c }} />{t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}

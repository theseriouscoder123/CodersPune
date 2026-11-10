import { ImageResponse } from "next/og";

export const alt = "Baton: evidence-graded knowledge handovers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "#f7f4ee", padding: "64px 72px", color: "#1b2230", fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#1b2230" />
            <rect x="7" y="14" width="18" height="4.5" rx="2.25" fill="#d9961b" transform="rotate(-30 16 16)" />
            <circle cx="9.6" cy="20.6" r="1.4" fill="#f7f4ee" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 700 }}>Baton</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 70, fontWeight: 700, lineHeight: 1.05, maxWidth: 980 }}>When someone leaves, keep the reasoning, not just the files.</div>
          <div style={{ fontSize: 30, color: "#5f636e", maxWidth: 980, fontFamily: "Helvetica, Arial, sans-serif" }}>
            Every claim cites its exact source. Statuses come from rules. The successor sees only what they&apos;re allowed to.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontFamily: "Helvetica, Arial, sans-serif", fontSize: 24 }}>
          {[["Verified", "#1f6f4a", "#dcefe4"], ["Supported", "#2b5d9a", "#dfe8f4"], ["Conflicting", "#a2470f", "#fbe9dc"], ["Missing", "#a8323a", "#f7dfe0"]].map(([t, fg, bg]) => (
            <div key={t} style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: bg, color: fg, fontWeight: 600 }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}

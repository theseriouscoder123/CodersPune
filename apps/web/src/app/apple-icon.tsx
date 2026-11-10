import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#1b2230", alignItems: "center", justifyContent: "center" }}>
        <svg width="150" height="150" viewBox="0 0 32 32">
          <rect x="7" y="14" width="18" height="4.5" rx="2.25" fill="#d9961b" transform="rotate(-30 16 16)" />
          <circle cx="9.6" cy="20.6" r="1.4" fill="#f7f4ee" />
        </svg>
      </div>
    ),
    size,
  );
}

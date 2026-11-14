import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#191918", alignItems: "center", justifyContent: "center" }}>
        <svg width="150" height="150" viewBox="0 0 32 32">
          <rect x="7.5" y="13.9" width="17" height="4.2" rx="2.1" fill="#ffffff" transform="rotate(-30 16 16)" />
          <circle cx="23.2" cy="11.8" r="2" fill="#0b6bde" />
        </svg>
      </div>
    ),
    size,
  );
}

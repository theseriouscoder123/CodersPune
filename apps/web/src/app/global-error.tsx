"use client";

/** Last resort when the root layout itself fails: no app styles are guaranteed here, so keep it plain. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#ffffff", color: "#191918", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 16, fontWeight: 600 }}>Baton hit an unexpected problem</h1>
          <p style={{ color: "#6a6a66", fontSize: 13 }}>Your review work is saved on the server. Reload to continue.</p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: "6px 12px", borderRadius: 6, border: 0, background: "#0b6bde", fontSize: 13, color: "#fff", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

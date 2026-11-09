"use client";

/** Last resort when the root layout itself fails: no app styles are guaranteed here, so keep it plain. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f7f4ee", color: "#1b2230", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>Baton hit an unexpected problem</h1>
          <p style={{ color: "#5b6474" }}>Your review work is saved on the server. Reload to continue.</p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: "10px 18px", borderRadius: 12, border: 0, background: "#1b2230", color: "#fff", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

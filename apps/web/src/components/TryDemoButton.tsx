"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";

export function TryDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ workspace_id: string }>("/demo/start", { method: "POST" });
            router.push(`/w/${r.workspace_id}/sources`);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
        className="rounded-lg bg-navy px-5 py-3 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-60"
        data-testid="try-demo"
      >
        {busy ? "Opening the demo…" : "Try the demo (no sign-up)"}
      </button>
      {error && <p className="mt-2 text-sm text-rose-700">Couldn&apos;t open the demo: {error}</p>}
    </div>
  );
}

"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { api } from "@/lib/api";

export function TryDemoButton({ inverted = false }: { inverted?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        size="lg"
        loading={busy}
        className={inverted ? "!bg-amber !text-on-amber hover:!bg-amber/90" : ""}
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
        data-testid="try-demo"
      >
        {busy ? "Preparing your copy…" : "Try the demo"} {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>
      {error && <p className={`mt-2 text-sm ${inverted ? "text-amber" : "text-missing"}`}>Couldn&apos;t open the demo: {error}</p>}
    </div>
  );
}

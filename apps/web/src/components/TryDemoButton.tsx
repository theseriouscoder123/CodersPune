"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { api } from "@/lib/api";

export function TryDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="max-sm:w-full">
      <Button
        size="lg"
        loading={busy}
        className="max-sm:w-full"
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
        {busy ? "Preparing your copy…" : "Try the demo"} {!busy && <ArrowRight />}
      </Button>
      {error && <p className="mt-2 text-[13px] text-mis">Couldn&apos;t open the demo: {error}</p>}
    </div>
  );
}

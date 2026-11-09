"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-md px-5 py-16" role="alert">
      <div className="animate-pop rounded-2xl border border-line bg-card p-8 text-center shadow-[var(--shadow-md)]">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-missing-soft text-missing"><TriangleAlert className="h-5 w-5" /></div>
        <h1 className="font-display mt-4 text-xl font-semibold text-ink">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-muted">Nothing you reviewed has been lost; every action is saved on the server as you make it.</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-muted">reference {error.digest}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => reset()}><RotateCcw className="h-4 w-4" /> Try again</Button>
          <ButtonLink href="/" variant="secondary">Start page</ButtonLink>
        </div>
      </div>
    </div>
  );
}

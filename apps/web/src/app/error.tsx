"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-20 text-center" role="alert">
      <div>
        <div className="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-line text-mis"><TriangleAlert className="h-4 w-4" /></div>
        <h1 className="mt-4 text-[16px] font-semibold text-fg">Something went wrong on this page</h1>
        <p className="mt-1 text-[13px] leading-5 text-fg-3">Nothing you reviewed has been lost; every action is saved on the server as you make it.</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-fg-3">reference {error.digest}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => reset()}><RotateCcw /> Try again</Button>
          <ButtonLink size="sm" href="/" variant="secondary">Start page</ButtonLink>
        </div>
      </div>
    </div>
  );
}

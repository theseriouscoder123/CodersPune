import { Compass } from "lucide-react";

import { Logo } from "@/components/Logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-bg px-4 py-16">
      <div className="w-full max-w-[420px] text-center">
        <div className="flex justify-center"><Logo /></div>
        <div className="mx-auto mt-10 grid h-9 w-9 place-items-center rounded-lg border border-line text-fg-3"><Compass className="h-4 w-4" /></div>
        <h1 className="mt-4 text-[16px] font-semibold text-fg">This page doesn&apos;t exist</h1>
        <p className="mt-1 text-[13px] leading-5 text-fg-3">The link may be old, or the workspace may have been reset. Your own demo copy is always one click away.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <ButtonLink size="sm" href="/">Go to the start page</ButtonLink>
        </div>
      </div>
    </main>
  );
}

import { Compass } from "lucide-react";

import { Logo } from "@/components/Logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="paper-grain flex flex-1 flex-col items-center justify-center px-5 py-16">
      <div className="animate-pop w-full max-w-md rounded-lg border border-line bg-bg p-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <div className="mx-auto mt-6 grid h-11 w-11 place-items-center rounded-full bg-bg-sunk text-fg-2"><Compass className="h-5 w-5" /></div>
        <h1 className="mt-4 text-2xl font-semibold text-fg">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm text-fg-3">The link may be old, or the workspace may have been reset. Your own demo copy is always one click away.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href="/">Go to the start page</ButtonLink>
        </div>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";

import { useWorkspace } from "./WorkspaceShell";

/** Shown when the acting persona isn't allowed on a step. The server enforces this too; this just explains it. */
export function NotForPersona({ step }: { step: string }) {
  const { ws } = useWorkspace();
  const successor = ws.persona.roles.includes("successor");
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-panel p-8 text-center">
      <p className="text-lg font-semibold text-navy">{step} isn&apos;t shared with {ws.persona.name}</p>
      <p className="mt-2 text-sm text-muted">
        Only the reviewer and the leaver see the draft ledger. {successor ? "As the successor, you see the approved handover." : ""}
        Switch persona at the top right to see other views.
      </p>
      {successor && (
        <Link href={`/w/${ws.id}/handover`} className="mt-5 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">
          Open my handover →
        </Link>
      )}
    </div>
  );
}

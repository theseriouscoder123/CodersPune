"use client";

import { ArrowRight, Lock } from "lucide-react";

import { ButtonLink, EmptyState } from "@/components/ui";

import { useWorkspace } from "./WorkspaceShell";

/** Shown when the acting persona isn't allowed on a step. The server enforces this too; this explains it. */
export function NotForPersona({ step }: { step: string }) {
  const { ws } = useWorkspace();
  const successor = ws.persona.roles.includes("successor");
  return (
    <div className="mx-auto max-w-lg pt-6">
      <EmptyState icon={<Lock className="h-5 w-5" />} title={`${step} isn't shared with ${ws.persona.name}`}
        action={successor ? <ButtonLink href={`/w/${ws.id}/handover`}>Open my handover <ArrowRight className="h-4 w-4" /></ButtonLink> : undefined}>
        Only the reviewer and the leaver see the draft ledger.{successor ? " As the successor, you see the approved handover." : ""} Switch
        persona at the top right to see other views.
      </EmptyState>
    </div>
  );
}

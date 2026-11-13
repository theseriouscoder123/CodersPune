"use client";

import { ArrowRight, Mic } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { InterviewSummary } from "@/components/interview/types";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { useApi } from "@/lib/useApi";

/** Tells the leaver they have gap-interview questions waiting. Server-filtered: only interviews sent to this person. */
export function LeaverBanner() {
  const { ws } = useWorkspace();
  const path = usePathname();
  const isLeaver = ws.persona.roles.includes("leaver") && !ws.persona.roles.includes("reviewer");
  const list = useApi<{ interviews: InterviewSummary[] }>(isLeaver ? `/workspaces/${ws.id}/interviews` : null);
  const waiting = list.data?.interviews.find((i) => i.status === "sent");
  if (!waiting || path?.includes("/interview/")) return null;
  const left = waiting.total - waiting.answered;
  return (
    <div className="no-print mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6" data-testid="leaver-banner">
      <Link href={`/w/${ws.id}/interview/${waiting.id}`}
        className="animate-rise flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-ink transition hover:border-amber">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-amber text-white"><Mic className="h-4 w-4" /></span>
          <span><b>You have {left} handover question{left === 1 ? "" : "s"} to answer.</b> Baton couldn&apos;t find these in the project. It takes a few minutes.</span>
        </span>
        <span className="inline-flex items-center gap-1 font-semibold">Answer now <ArrowRight className="h-4 w-4" /></span>
      </Link>
    </div>
  );
}

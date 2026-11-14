"use client";

import { ArrowRight, CalendarClock, Mic } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { InterviewSummary } from "@/components/interview/types";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import type { HandoverRef } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/** Tells the leaver what is waiting for them: gap-interview questions first, otherwise the "before you leave"
 *  checklist with the days left. Server-filtered: only interviews and handovers this person is part of. */
export function LeaverBanner() {
  const { ws } = useWorkspace();
  const path = usePathname();
  const isLeaver = ws.persona.roles.includes("leaver") && !ws.persona.roles.includes("reviewer");
  const list = useApi<{ interviews: InterviewSummary[] }>(isLeaver ? `/workspaces/${ws.id}/interviews` : null);
  const hs = useApi<{ handovers: HandoverRef[] }>(isLeaver ? `/workspaces/${ws.id}/handovers` : null);
  const mine = hs.data?.handovers.find((h) => h.leaver_id === ws.persona.id);
  const leaving = useApi<{ days_left: number | null; counts: { total: number; done: number } }>(
    isLeaver && mine ? `/handovers/${mine.id}/leaving` : null);
  const waiting = list.data?.interviews.find((i) => i.status === "sent");
  if (!isLeaver || path?.includes("/interview/") || path?.includes("/leaving")) return null;
  const tone = "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft px-3.5 py-2.5 text-[13px] text-fg transition-colors hover:border-line-2";
  if (waiting) {
    const left = waiting.total - waiting.answered;
    return (
      <div className="no-print mx-auto w-full max-w-[1160px] px-4 pt-4 sm:px-8 lg:px-10" data-testid="leaver-banner">
        <Link href={`/w/${ws.id}/interview/${waiting.id}`} className={tone}>
          <span className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white"><Mic className="h-4 w-4" /></span>
            <span><b>You have {left} handover question{left === 1 ? "" : "s"} to answer.</b> Baton couldn&apos;t find these in the project. It takes a few minutes.</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-accent-ink">Answer now <ArrowRight className="h-4 w-4" /></span>
        </Link>
      </div>
    );
  }
  const d = leaving.data;
  if (!mine || !d || d.counts.total === d.counts.done) return null;
  const open = d.counts.total - d.counts.done;
  const when = d.days_left === null ? "" : d.days_left < 0 ? "Your last day has passed. " : d.days_left === 0 ? "Today is your last day. " : `${d.days_left} day${d.days_left === 1 ? "" : "s"} left. `;
  return (
    <div className="no-print mx-auto w-full max-w-[1160px] px-4 pt-4 sm:px-8 lg:px-10" data-testid="leaver-banner">
      <Link href={`/w/${ws.id}/leaving?h=${mine.id}`} className={tone}>
        <span className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white"><CalendarClock className="h-4 w-4" /></span>
          <span><b>{when}{open} thing{open === 1 ? "" : "s"} to do before you leave.</b> Only you can settle these.</span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-accent-ink">Open the checklist <ArrowRight className="h-4 w-4" /></span>
      </Link>
    </div>
  );
}

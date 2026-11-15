"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { api, type WorkspaceInfo } from "@/lib/api";
import { useChanges } from "@/lib/useApi";

type TourState = { reviewed: number; approved: boolean; successor_id: string | null };

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the checklist still works for this page view */
  }
  listeners.forEach((l) => l());
};

/**
 * Getting-started checklist for a first-time visitor (no walkthrough): the six steps of the scored loop, with the
 * next one highlighted. Review and approval progress come from the server; page visits are remembered per browser.
 */
export function TourChecklist({ ws, onSwitchPersona }: { ws: WorkspaceInfo; onSwitchPersona: (memberId: string) => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `baton:tour:${ws.id}`;
  const changes = useChanges();
  const visited = useSyncExternalStore(subscribe, () => read(`${base}:visited`) ?? "", () => "");
  const hidden = useSyncExternalStore(subscribe, () => read(`${base}:hidden`) === "1", () => true);
  const [server, setServer] = useState<TourState | null>(null);
  const isSuccessor = ws.persona.roles.includes("successor");

  // Remember which steps' pages this visitor has opened (and as whom, for the successor step).
  const page = pathname.split(`/w/${ws.id}/`)[1] ?? "";
  useEffect(() => {
    const key = page === "handover" && isSuccessor ? "handover-successor" : page;
    if (!key) return;
    const set = new Set(visited.split(",").filter(Boolean));
    if (!set.has(key)) {
      set.add(key);
      write(`${base}:visited`, [...set].join(","));
    }
  }, [page, isSuccessor, visited, base]);

  useEffect(() => {
    let cancelled = false;
    api<TourState>(`/workspaces/${ws.id}/tour`, { workspaceId: ws.id })
      .then((t) => !cancelled && setServer(t))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ws.id, pathname, ws.persona.id, changes]);

  if (ws.read_only) return null;
  const seen = new Set(visited.split(",").filter(Boolean));
  const successorName = ws.members.find((m) => m.roles.includes("successor"))?.name ?? "the successor";
  const reviewerId = ws.members.find((m) => m.roles.includes("reviewer"))?.id;

  const asReviewer = (href: string) => () => {
    if (reviewerId && ws.persona.id !== reviewerId) onSwitchPersona(reviewerId);
    router.push(`/w/${ws.id}/${href}`);
  };
  const steps = [
    { key: "sources", label: "See the sources and who can access each", done: seen.has("sources"), go: () => router.push(`/w/${ws.id}/sources`) },
    { key: "ledger", label: "Read the ledger and decision timeline", done: seen.has("ledger"), go: asReviewer("ledger") },
    { key: "review", label: "Inspect a claim's quoted evidence", done: seen.has("review"), go: asReviewer("review") },
    { key: "reviewed", label: "Confirm, edit or reject a claim", done: (server?.reviewed ?? 0) > 0, go: asReviewer("review") },
    { key: "approved", label: `Preview ${successorName}'s view and approve`, done: !!server?.approved, go: asReviewer("review/preview") },
    {
      key: "handover-successor", label: `Switch to ${successorName} and read the handover`, done: seen.has("handover-successor"),
      go: () => {
        if (server?.successor_id && ws.persona.id !== server.successor_id) onSwitchPersona(server.successor_id);
        router.push(`/w/${ws.id}/handover`);
      },
    },
  ];
  // A step the visitor skipped past (they already did a later one) counts as done, so the highlighted step is never
  // behind their real progress.
  const lastDone = steps.map((s) => s.done).lastIndexOf(true);
  steps.forEach((s, i) => { if (i < lastDone && !s.done && ["sources", "ledger", "review"].includes(s.key)) s.done = true; });
  const doneCount = steps.filter((s) => s.done).length;
  const reviewerName = ws.members.find((m) => m.roles.includes("reviewer"))?.name ?? "the reviewer";
  const asWhom: Record<string, string> = isSuccessor ? { ledger: reviewerName, review: reviewerName, reviewed: reviewerName, approved: reviewerName } : {};
  const next = steps.find((s) => !s.done);

  if (hidden) {
    return (
      <button type="button" onClick={() => write(`${base}:hidden`, null)} data-testid="tour-open"
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        aria-label={next ? `Getting started, ${doneCount} of 6 steps done` : "Getting started: tour complete"}>
        <span className="flex-1 text-left">Getting started</span>
        <span className="text-[12px] text-fg-3">{next ? `${doneCount} of 6` : "Tour complete"}</span>
      </button>
    );
  }
  return (
    <div className="no-print rounded-lg border border-line bg-bg p-2.5" data-testid="tour">
      <div className="flex items-center gap-2 px-0.5">
        <p className="flex-1 text-[12.5px] font-semibold text-fg">Getting started</p>
        <span className="text-[12px] text-fg-3" data-testid="tour-open" aria-label={next ? `${doneCount} of 6 steps done` : "Tour complete"}>
          {next ? `${doneCount} of 6` : "Tour complete"}
        </span>
        <button type="button" onClick={() => write(`${base}:hidden`, "1")} aria-label="Hide getting started"
          className="grid h-5 w-5 place-items-center rounded text-fg-3 transition-colors hover:bg-hover hover:text-fg"><X className="h-3 w-3" /></button>
      </div>
      <div className="mt-2 flex gap-[3px] px-0.5" aria-hidden>
        {steps.map((s) => <span key={s.key} className={`h-1 flex-1 rounded-sm ${s.done ? "bg-ver" : s === next ? "bg-accent" : "bg-line-2"}`} />)}
      </div>
      <ol className="mt-2 space-y-px">
        {steps.map((s) => {
          const isNext = s === next;
          return (
            <li key={s.key}>
              <button type="button" onClick={() => s.go()} title={asWhom[s.key] ? `Switches you to ${asWhom[s.key]}, who does this step` : undefined}
                className={`flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12px] leading-[17px] transition-colors ${isNext ? "bg-accent-soft text-fg" : s.done ? "text-fg-3 hover:bg-hover" : "text-fg-2 hover:bg-hover"}`}>
                <svg width="12" height="12" viewBox="0 0 14 14" className="mt-[2.5px] shrink-0" aria-hidden>
                  {s.done ? <><circle cx="7" cy="7" r="6" fill="var(--ver)" /><path d="M4.4 7.2l1.7 1.7 3.5-3.6" stroke="var(--bg)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>
                    : <circle cx="7" cy="7" r="5.6" fill="none" stroke={isNext ? "var(--accent)" : "var(--fg-4)"} strokeWidth="1.5" />}
                </svg>
                <span className="flex-1">{s.label}{asWhom[s.key] && !s.done && <span className="text-fg-3"> (as {asWhom[s.key]})</span>}</span>
                {isNext && <span className="shrink-0 font-semibold text-accent-ink">Go</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {!next && (
        <p className="mt-2 border-t border-line px-1 pt-2 text-[12px] leading-[17px] text-fg-3">
          <b className="font-semibold text-fg">You&apos;ve seen the whole loop.</b>{" "}
          <Link href="/new" className="text-accent-ink hover:underline">Try it on your own repo →</Link>
        </p>
      )}
    </div>
  );
}

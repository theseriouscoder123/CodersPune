"use client";

import { Check, ChevronDown, Compass, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { api, type WorkspaceInfo } from "@/lib/api";

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
  const visited = useSyncExternalStore(subscribe, () => read(`${base}:visited`) ?? "", () => "");
  const hidden = useSyncExternalStore(subscribe, () => read(`${base}:hidden`) === "1", () => true);
  const [open, setOpen] = useState(false);
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
  }, [ws.id, pathname, ws.persona.id]);

  if (hidden || ws.read_only) return null;
  const seen = new Set(visited.split(",").filter(Boolean));
  const successorName = ws.members.find((m) => m.roles.includes("successor"))?.name ?? "the successor";
  const reviewerId = ws.members.find((m) => m.roles.includes("reviewer"))?.id;

  const asReviewer = (href: string) => () => {
    if (reviewerId && ws.persona.id !== reviewerId) onSwitchPersona(reviewerId);
    router.push(`/w/${ws.id}/${href}`);
  };
  const steps = [
    { key: "sources", label: "See the connected sources and who can access each", done: seen.has("sources"), go: () => router.push(`/w/${ws.id}/sources`) },
    { key: "ledger", label: "Read the reconstructed ledger and decision timeline", done: seen.has("ledger"), go: asReviewer("ledger") },
    { key: "review", label: "Open a claim and inspect its quoted evidence", done: seen.has("review"), go: asReviewer("review") },
    { key: "reviewed", label: "Confirm, edit or reject a claim as the reviewer", done: (server?.reviewed ?? 0) > 0, go: asReviewer("review") },
    { key: "approved", label: "Preview the successor's view and approve a version", done: !!server?.approved, go: asReviewer("review/preview") },
    {
      key: "handover-successor", label: `Switch to ${successorName} and read the handover`, done: seen.has("handover-successor"),
      go: () => {
        if (server?.successor_id && ws.persona.id !== server.successor_id) onSwitchPersona(server.successor_id);
        router.push(`/w/${ws.id}/handover`);
      },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <div className="no-print fixed bottom-4 right-4 z-30 w-[min(360px,calc(100vw-2rem))]" data-testid="tour">
      {open ? (
        <div className="animate-pop rounded-2xl border border-line bg-card shadow-[var(--shadow-lg)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Compass className="h-4 w-4 text-amber-ink" /> Demo tour · {doneCount}/6</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:bg-paper-2 hover:text-ink" aria-label="Collapse tour"><ChevronDown className="h-4 w-4" /></button>
              <button onClick={() => write(`${base}:hidden`, "1")} className="rounded-lg p-1 text-muted hover:bg-paper-2 hover:text-ink" aria-label="Hide tour"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <ol className="space-y-0.5 p-2">
            {steps.map((s, i) => {
              const isNext = s === next;
              return (
                <li key={s.key} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm ${isNext ? "bg-amber-soft/70" : ""}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${s.done ? "bg-verified-solid text-white" : isNext ? "bg-amber text-on-amber" : "bg-paper-2 text-muted"}`}>
                    {s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={`flex-1 leading-snug ${s.done ? "text-muted line-through decoration-line-2" : "text-ink"}`}>{s.label}</span>
                  {!s.done && (
                    <button onClick={() => { s.go(); }} className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${isNext ? "bg-strong text-on-strong" : "text-ink-2 hover:bg-paper-2"}`}>Go</button>
                  )}
                </li>
              );
            })}
          </ol>
          {!next && (
            <div className="border-t border-line px-4 py-3 text-sm">
              <p className="font-semibold text-ink">You&apos;ve seen the whole loop.</p>
              <p className="mt-0.5 text-xs text-muted">Try it on a real project: <Link href="/new" className="font-medium text-ink underline underline-offset-2">build a ledger from any public GitHub repo</Link>.</p>
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setOpen(true)} data-testid="tour-open"
          className="animate-rise ml-auto flex items-center gap-2 rounded-full border border-line bg-card py-2 pl-3 pr-4 text-sm font-medium text-ink shadow-[var(--shadow-md)] transition hover:shadow-[var(--shadow-lg)]">
          <span className="relative grid h-6 w-6 place-items-center rounded-full bg-amber-soft text-amber-ink"><Compass className="h-3.5 w-3.5" /></span>
          {next ? <>Demo tour <span className="text-muted">{doneCount}/6</span></> : <>Tour complete <Check className="h-4 w-4 text-verified" /></>}
        </button>
      )}
    </div>
  );
}

"use client";

import { Lightbulb, X } from "lucide-react";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function isDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** One-sentence, dismissible explanation of the current step (first-time visitors, no walkthrough). */
export function CoachBar({ id, step, children }: { id: string; step?: string; children: React.ReactNode }) {
  const key = `baton:coach:${id}`;
  const dismissed = useSyncExternalStore(subscribe, () => isDismissed(key), () => true);
  if (dismissed) return null;
  return (
    <div className="animate-rise mb-6 flex items-start gap-3 rounded-2xl border border-amber/30 bg-amber-soft/70 px-4 py-3.5 text-sm text-ink" role="note">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber/20 text-amber-ink"><Lightbulb className="h-4 w-4" /></span>
      <div className="flex-1 leading-relaxed">
        {step && <span className="mr-1.5 font-semibold text-amber-ink">{step}</span>}
        {children}
      </div>
      <button type="button" aria-label="Dismiss tip" className="rounded-lg p-1 text-muted transition hover:bg-amber/15 hover:text-ink"
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {
            /* ignore */
          }
          listeners.forEach((l) => l());
        }}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

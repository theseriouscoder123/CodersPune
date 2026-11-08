"use client";

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

/** One-sentence, dismissible explanation of the current step (usability: first-time visitors, no walkthrough). */
export function CoachBar({ id, children }: { id: string; children: React.ReactNode }) {
  const key = `baton:coach:${id}`;
  // Server snapshot = hidden, so prerendered HTML never flashes a bar the visitor already dismissed.
  const dismissed = useSyncExternalStore(subscribe, () => isDismissed(key), () => true);
  if (dismissed) return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-navy" role="note">
      <span aria-hidden className="mt-0.5">💡</span>
      <div className="flex-1">{children}</div>
      <button
        type="button"
        className="text-xs font-semibold text-muted hover:text-navy"
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {
            /* ignore */
          }
          listeners.forEach((l) => l());
        }}
      >
        Got it
      </button>
    </div>
  );
}

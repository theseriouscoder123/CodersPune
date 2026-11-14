"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Pref = "system" | "light" | "dark";
const KEY = "baton:theme";
const ORDER: Pref[] = ["system", "light", "dark"];
const listeners = new Set<() => void>();

function read(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: Pref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const pref = useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), read, () => "system" as Pref);
  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  const label = { system: "Theme: follows your system", light: "Theme: light", dark: "Theme: dark" }[pref];
  return (
    <button
      type="button"
      onClick={() => {
        try {
          if (next === "system") localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch {
          /* private mode: still switch for this page view */
        }
        apply(next);
        listeners.forEach((l) => l());
      }}
      title={`${label}. Click for ${next}.`}
      aria-label={`${label}. Switch to ${next}.`}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg ${className}`}
      data-testid="theme-toggle"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

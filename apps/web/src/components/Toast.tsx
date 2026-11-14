"use client";

import { CheckCircle2, Info, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

type Tone = "success" | "error" | "info";
type Action = { label: string; onClick: () => void };
type ToastItem = { id: number; tone: Tone; text: string; action?: Action };
type Push = (text: string, tone?: Tone, action?: Action) => void;

const ToastContext = createContext<Push>(() => {});

/** `toast("Saved")`, or with an inline action: `toast("Rejected", "success", { label: "Undo", onClick })`. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>((text, tone = "success", action) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, tone, text, action }]);
    setTimeout(() => dismiss(id), action ? 7000 : 4200); // a little longer when there's something to click
  }, [dismiss]);
  const ICON = { success: CheckCircle2, error: XCircle, info: Info };
  const TONE = { success: "text-[var(--toast-ver)]", error: "text-[var(--toast-mis)]", info: "text-[var(--toast-acc)]" };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[60] flex flex-col items-start gap-2 sm:right-auto" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div key={t.id} className="animate-pop pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg bg-fg px-3.5 py-2.5 text-[13px] text-bg shadow-[var(--pop)]">
              <Icon className={`h-4 w-4 shrink-0 ${TONE[t.tone]}`} />
              <span>{t.text}</span>
              {t.action && (
                <button onClick={() => { dismiss(t.id); t.action!.onClick(); }} data-testid="toast-action"
                  className="-my-1 ml-1 rounded-md px-2 py-1 text-[13px] font-semibold text-[var(--toast-acc)] underline-offset-2 hover:underline">
                  {t.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

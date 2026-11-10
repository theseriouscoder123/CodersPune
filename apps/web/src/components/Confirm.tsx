"use client";

import { AlertTriangle, HelpCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import { Button, Modal } from "@/components/ui";

type Options = { title: string; body?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default" };
type Ask = (o: Options) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

/** In-app confirmation dialog (replaces the browser's confirm()): `if (!(await confirm({ title }))) return;` */
export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const done = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const danger = opts?.tone === "danger";
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Modal open={!!opts} onClose={() => done(false)} label={opts?.title ?? "Confirm"}>
        {opts && (
          <div data-testid="confirm-dialog">
            <div className="flex items-start gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${danger ? "bg-missing-soft text-missing" : "bg-amber-soft text-amber-ink"}`}>
                {danger ? <AlertTriangle className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
              </span>
              <div>
                <p className="font-display text-lg font-semibold leading-snug text-ink">{opts.title}</p>
                {opts.body && <div className="mt-1.5 text-sm leading-relaxed text-muted">{opts.body}</div>}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => done(false)}>{opts.cancelLabel ?? "Cancel"}</Button>
              <Button variant={danger ? "danger" : "primary"} onClick={() => done(true)} data-testid="confirm-ok">{opts.confirmLabel ?? "Continue"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

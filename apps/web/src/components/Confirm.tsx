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
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line ${danger ? "text-mis" : "text-fg-3"}`}>
                {danger ? <AlertTriangle className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />}
              </span>
              <div>
                <p className="text-[14px] font-semibold leading-5 text-fg">{opts.title}</p>
                {opts.body && <div className="mt-1 text-[13px] leading-5 text-fg-3">{opts.body}</div>}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => done(false)}>{opts.cancelLabel ?? "Cancel"}</Button>
              <Button variant="primary" className={danger ? "!border-mis !bg-mis hover:!bg-mis/90" : ""} onClick={() => done(true)} data-testid="confirm-ok">{opts.confirmLabel ?? "Continue"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, ButtonLink, Card, PageHeader, Spinner } from "@/components/ui";
import { api, type RunInfo } from "@/lib/api";

/** Live run progress. This page also DRIVES the run: each /advance call does one bounded slice (DECISIONS D8). */
export default function RunPage() {
  const { ws } = useWorkspace();
  const { run } = useParams<{ run: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const active = useRef(true);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    active.current = true;
    (async () => {
      while (active.current) {
        try {
          const r = await api<RunInfo>(`/runs/${run}/advance`, { workspaceId: ws.id, method: "POST" });
          if (!active.current) break;
          setInfo(r);
          setErr(null);
          if (r.status === "done") {
            setTimeout(() => router.push(`/w/${ws.id}/ledger`), 1800);
            break;
          }
          if (r.status === "failed") break;
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          await new Promise((res) => setTimeout(res, 3000));
        }
        await new Promise((res) => setTimeout(res, 1200));
      }
    })();
    return () => {
      active.current = false;
    };
  }, [run, ws.id, router]);

  const steps = info?.steps ?? [];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const pct = steps.length ? Math.round((100 * doneCount) / steps.length) : 0;
  const secs = Math.floor((now - started) / 1000);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Reconstruct" title={info?.status === "done" ? "Ledger ready" : "Reconstructing the project"}
        description="Keep this page open: the run moves forward while you watch, and resumes if you come back later." />

      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-ink">{info?.status === "done" ? "Done. Opening the ledger…" : info?.status === "failed" ? "Stopped" : "Working…"}</span>
          <span className="font-mono text-xs text-muted">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-2">
          <div className={`h-full rounded-full transition-all duration-700 ${info?.status === "failed" ? "bg-missing" : "bg-amber"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
      </Card>

      {err && <Alert tone="warn" className="mt-4">Connection issue: {err}. Retrying…</Alert>}
      {info?.status === "failed" && (
        <Alert tone="error" className="mt-4">
          <p className="font-semibold">The run stopped</p>
          <p className="mt-1">{info.error}</p>
          <ButtonLink href={`/w/${ws.id}/ledger`} variant="secondary" size="sm" className="mt-3">Back to the ledger</ButtonLink>
        </Alert>
      )}

      <ol className="stagger mt-5 space-y-2">
        {steps.map((s) => {
          const running = s.status === "running";
          return (
            <li key={s.step} className={`rounded-2xl border p-4 transition ${running ? "border-amber/40 bg-card shadow-[var(--shadow-md)]" : "border-line bg-card/60"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <span className={`grid h-7 w-7 place-items-center rounded-full ${s.status === "done" ? "bg-verified-solid text-white" : s.status === "failed" ? "bg-missing-solid text-white" : running ? "bg-amber-soft text-amber-ink" : "bg-paper-2 text-muted"}`}>
                    {s.status === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s.status === "failed" ? <X className="h-3.5 w-3.5" /> : running ? <Spinner className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <span className={`text-sm font-medium ${s.status === "pending" ? "text-muted" : "text-ink"}`}>{s.label}</span>
                </span>
                {s.total > 0 && <span className="font-mono text-xs text-muted">{s.progress}/{s.total}</span>}
              </div>
              {s.message && s.status !== "pending" && <p className="mt-1.5 pl-10 text-xs text-muted">{s.message}</p>}
              {running && s.total > 0 && (
                <div className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2"><div className="h-full rounded-full bg-amber transition-all duration-500" style={{ width: `${Math.round((100 * s.progress) / s.total)}%` }} /></div>
              )}
              {s.errors.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 pl-10 text-xs text-conflicting"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {s.errors.length} issue(s), the run continues: {s.errors[s.errors.length - 1]}</p>
              )}
            </li>
          );
        })}
        {!info && <li className="flex items-center gap-2 text-sm text-muted"><Spinner /> Starting…</li>}
      </ol>
    </div>
  );
}

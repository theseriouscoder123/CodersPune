"use client";

import { AlertTriangle, Square } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { PassIcon, PendingIcon, StatusIcon } from "@/components/ledger/StatusChip";
import { TopbarActions, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError, type RunInfo } from "@/lib/api";

const ENDED = ["done", "failed", "cancelled"];

/** A run stopped by the free AI tier (not by the data): say so, and what to do. */
function isQuota(error: string | null | undefined) {
  return !!error && /quota|busy|rate.?limit|429|too many requests/i.test(error);
}

/** Live run progress. This page also DRIVES the run: each /advance call does one bounded slice (DECISIONS D8). */
export default function RunPage() {
  const { ws } = useWorkspace();
  const { run } = useParams<{ run: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const active = useRef(true);
  const [live, setLive] = useState(false); // true once this page has watched the run in progress
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canDrive = ws.persona.roles.includes("admin") && !ws.read_only;

  async function retry() {
    setRetrying(true);
    try {
      await api(`/runs/${run}/retry`, { workspaceId: ws.id, method: "POST" });
      window.location.reload(); // re-enter the live loop from the step where it stopped
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRetrying(false);
    }
  }

  async function cancel() {
    const ok = await confirm({
      title: "Cancel this run?",
      body: "The step in progress stops after its current item. Claims found so far are kept, and you can resume the run later from where it stopped.",
      confirmLabel: "Cancel run", cancelLabel: "Keep running", tone: "danger",
    });
    if (!ok) return;
    setCancelling(true);
    try {
      const r = await api<RunInfo>(`/runs/${run}/cancel`, { workspaceId: ws.id, method: "POST" });
      active.current = false;
      setInfo(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    active.current = true;
    (async () => {
      let watching = false;
      let readOnly = false;
      try {
        const first = await api<RunInfo>(`/runs/${run}`, { workspaceId: ws.id });
        if (!active.current) return;
        setInfo(first);
        if (ENDED.includes(first.status)) return; // a finished run: just show how it went
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      while (active.current) {
        try {
          const r = readOnly
            ? await api<RunInfo>(`/runs/${run}`, { workspaceId: ws.id })
            : await api<RunInfo>(`/runs/${run}/advance`, { workspaceId: ws.id, method: "POST" });
          if (!active.current) break;
          setInfo(r);
          setErr(null);
          if (!watching) {
            watching = true;
            setLive(true);
          }
          if (r.status === "done") {
            setTimeout(() => router.push(`/w/${ws.id}/ledger`), 1800);
            break;
          }
          if (ENDED.includes(r.status)) break;
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) {
            readOnly = true; // someone else's run: follow it without driving it
            continue;
          }
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
  const finished = !!info && ENDED.includes(info.status);
  const running = !!info && !finished;
  const ranFor = info?.started_at && info?.finished_at ? (Date.parse(info.finished_at) - Date.parse(info.started_at)) / 1000 : null;
  const secs = Math.max(0, Math.floor(finished && !live && ranFor !== null ? ranFor : (now - started) / 1000));
  const history = finished && !live;
  const stopped = info?.status === "failed" || info?.status === "cancelled";

  // Progress in the browser tab, so the run can be followed from another tab.
  useEffect(() => {
    if (!info) return;
    const prev = document.title;
    const done = (info.steps ?? []).filter((x) => x.status === "done").length;
    const total = (info.steps ?? []).length;
    document.title = info.status === "done" ? "✓ Ledger ready · Baton" : info.status === "cancelled" ? "Run cancelled · Baton"
      : info.status === "failed" ? "Run stopped · Baton" : `${done}/${total} · Reconstructing… · Baton`;
    return () => { document.title = prev; };
  }, [info]);

  const stateLabel = !info ? "Loading…" : info.status === "done" ? (history ? "Completed" : "Done. Opening the ledger…")
    : info.status === "cancelled" ? "Cancelled" : info.status === "failed" ? "Stopped" : "Working…";

  return (
    <div className="mx-auto max-w-[720px]">
      <TopbarActions>
        {running && canDrive && <Button size="sm" variant="secondary" loading={cancelling} onClick={() => void cancel()} data-testid="cancel-run"><Square /> Cancel run</Button>}
        {history && !stopped && <ButtonLink size="sm" variant="ghost" href={`/w/${ws.id}/ledger`}>Back to the ledger</ButtonLink>}
      </TopbarActions>

      <PageHeader
        title={history ? "How this ledger was built" : info?.status === "done" ? "Ledger ready" : "Reconstructing the project"}
        description={history
          ? `Every step of the pipeline run${info?.finished_at ? ` that finished on ${new Date(info.finished_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}, with what it found.`
          : "Keep this page open: the run moves forward while you watch, and picks up where it left off if you come back later."} />

      <div className="mt-6 rounded-lg border border-line px-4 py-3">
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 font-medium text-fg">{running && <Spinner className="h-3.5 w-3.5" />}{stateLabel}</span>
          <span className="font-mono text-[12px] text-fg-3">{doneCount}/{steps.length || "–"} steps · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-hover">
          <div className={`h-full rounded-full transition-all duration-700 ${info?.status === "failed" ? "bg-mis" : info?.status === "cancelled" ? "bg-fg-3" : "bg-accent"}`} style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
      </div>

      {err && <Alert tone="warn" className="mt-4">Having trouble reaching the server ({err}). Retrying automatically…</Alert>}
      {stopped && info && (
        <div className="mt-4 rounded-lg border border-line px-4 py-3 text-[13px]" data-testid="run-stopped">
          <p className="font-semibold text-fg">{info.status === "cancelled" ? "The run was cancelled" : isQuota(info.error) ? "The free AI quota ran out" : "The run stopped"}</p>
          <p className="mt-1 text-fg-2">{info.error}</p>
          {info.status === "failed" && isQuota(info.error) && (
            <p className="mt-2 text-[12.5px] leading-[18px] text-fg-3" data-testid="quota-help">
              This is a limit of the free AI tier, not a problem with your sources. Per-minute limits clear within a few minutes; daily limits reset
              overnight. Nothing is lost: finished steps are kept, so resuming continues where it stopped. The demo workspace was computed in advance and needs no AI.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {canDrive && <Button size="sm" loading={retrying} onClick={() => void retry()} data-testid="retry-run">{info.status === "cancelled" ? "Resume the run" : "Retry from where it stopped"}</Button>}
            <ButtonLink href={`/w/${ws.id}/ledger`} variant="secondary" size="sm">Back to the ledger</ButtonLink>
          </div>
          {info.status === "failed" && !isQuota(info.error) && <p className="mt-2 text-[12px] text-fg-3">Finished steps are kept, so a retry doesn&apos;t repeat work that already succeeded.</p>}
        </div>
      )}

      <ol className="mt-5 divide-y divide-line overflow-hidden rounded-lg border border-line">
        {steps.map((s) => {
          const on = s.status === "running";
          return (
            <li key={s.step} className={`px-4 py-3 ${on ? "bg-accent-soft/40" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span className="grid h-4 w-4 place-items-center">
                    {s.status === "done" ? <PassIcon size={14} /> : s.status === "failed" ? <StatusIcon status="missing" size={14} /> : on ? <Spinner className="h-3.5 w-3.5 text-accent" /> : <PendingIcon size={14} />}
                  </span>
                  <span className={`text-[13px] ${s.status === "pending" ? "text-fg-3" : "font-medium text-fg"}`}>{s.label}</span>
                </span>
                {s.total > 0 && <span className="font-mono text-[12px] text-fg-3">{s.progress}/{s.total}</span>}
              </div>
              {s.message && s.status !== "pending" && <p className="mt-1 pl-[26px] text-[12.5px] text-fg-3">{s.message}</p>}
              {on && s.total > 0 && (
                <div className="ml-[26px] mt-2 h-1 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round((100 * s.progress) / s.total)}%` }} /></div>
              )}
              {s.errors.length > 0 && (
                <p className="mt-1.5 flex items-start gap-1.5 pl-[26px] text-[12.5px] text-con"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {s.errors.length} issue{s.errors.length === 1 ? "" : "s"}, the run continues: {s.errors[s.errors.length - 1]}</p>
              )}
            </li>
          );
        })}
        {!info && <li className="flex items-center gap-2 px-4 py-3 text-[13px] text-fg-3"><Spinner /> Loading the run…</li>}
      </ol>
    </div>
  );
}

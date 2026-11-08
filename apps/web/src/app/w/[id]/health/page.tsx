"use client";

import { Activity, AlertTriangle, ArrowLeft, Check, Clock, Cpu, Gauge, X } from "lucide-react";

import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, ButtonLink, Card, PageHeader, Pill, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/useApi";

type Health = {
  config: { provider: string; configured: boolean; verifier: string; extract_models: string[]; verify_models: string[] };
  totals: { calls: number; failed: number; failure_rate: number; daily_quota_hits: number; tokens: number };
  by_model: { purpose: string; model: string; calls: number; ok: number; failed: number; errors: Record<string, number>; tokens_in: number; tokens_out: number; p50_ms: number | null; p95_ms: number | null }[];
  runs: { id: string; status: string; mode: string; frozen: boolean; started_at: string | null; duration_s: number | null; error: string | null; inherited: boolean;
    steps: { step: string; label: string; status: string; message: string | null; issues: number }[] }[];
};

const PURPOSE: Record<string, string> = { extract: "Claim extraction", verify: "Independent verification", cover: "Checklist coverage", ask: "Ask the handover", smoke: "Smoke test" };

function Stat({ icon, label, value, tone = "" }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted">{icon} {label}</p>
      <p className={`font-display mt-1 text-3xl font-semibold ${tone || "text-ink"}`}>{value}</p>
    </Card>
  );
}

const fmtMs = (ms: number | null) => (ms == null ? "–" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtDur = (s: number | null) => (s == null ? "–" : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

export default function HealthPage() {
  const { ws } = useWorkspace();
  const allowed = ws.persona.roles.some((r) => r === "admin" || r === "reviewer");
  const { data, error, loading } = useApi<Health>(allowed ? `/workspaces/${ws.id}/pipeline-health` : null);
  if (!allowed) return <NotForPersona step="Pipeline health" />;

  return (
    <div>
      <PageHeader eyebrow="Operations" title="Pipeline health"
        description="What the AI pipeline did for this workspace, what failed and why. Metadata only: prompts and source text are never logged."
        actions={<ButtonLink href={`/w/${ws.id}/ledger`} variant="secondary"><ArrowLeft className="h-4 w-4" /> Back to the ledger</ButtonLink>} />
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}
      {loading && <div className="mt-6"><SkeletonList rows={3} /></div>}
      {data && (
        <>
          <div className="stagger mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={<Activity className="h-3.5 w-3.5" />} label="AI calls" value={data.totals.calls} />
            <Stat icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Failed (retried)" value={`${Math.round(data.totals.failure_rate * 100)}%`} tone={data.totals.failure_rate > 0.3 ? "text-conflicting" : ""} />
            <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Daily-quota fallbacks" value={data.totals.daily_quota_hits} />
            <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="Tokens" value={data.totals.tokens.toLocaleString()} />
          </div>

          <Card className="mt-5 p-5">
            <p className="font-semibold text-ink">Configuration</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
              <span>Provider: <b className="text-ink">{data.config.provider}</b> {data.config.configured ? <Pill className="ml-1 text-verified">configured</Pill> : <Pill className="ml-1 text-missing">not configured</Pill>}</span>
              <span>Extraction chain: {data.config.extract_models.map((m) => <Pill key={m} className="ml-1 font-mono">{m}</Pill>)}</span>
              <span>Verifier chain: {data.config.verify_models.map((m) => <Pill key={m} className="ml-1 font-mono">{m}</Pill>)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">A model whose daily free quota runs out is skipped for the next one in its chain. Failed calls are retried with backoff; a batch that still fails is reported, never silently dropped.</p>
          </Card>

          <h2 className="font-display mt-8 text-xl font-semibold text-ink">Calls by purpose and model</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-paper/60 text-xs uppercase tracking-wider text-muted">
                <tr><th className="px-4 py-2.5">Purpose</th><th className="px-4">Model</th><th className="px-4">Calls</th><th className="px-4">OK</th><th className="px-4">Failed</th><th className="px-4">Top errors</th><th className="px-4">Latency p50 / p95</th><th className="px-4">Tokens in / out</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.by_model.map((r) => (
                  <tr key={r.purpose + r.model}>
                    <td className="px-4 py-2.5 font-medium text-ink">{PURPOSE[r.purpose] ?? r.purpose}</td>
                    <td className="px-4 font-mono text-xs">{r.model}</td>
                    <td className="px-4">{r.calls}</td>
                    <td className="px-4 text-verified">{r.ok}</td>
                    <td className={`px-4 ${r.failed ? "text-conflicting" : "text-muted"}`}>{r.failed}</td>
                    <td className="px-4 text-xs text-muted">{Object.entries(r.errors).map(([k, n]) => `${k} ×${n}`).join(", ") || "–"}</td>
                    <td className="px-4 font-mono text-xs">{fmtMs(r.p50_ms)} / {fmtMs(r.p95_ms)}</td>
                    <td className="px-4 font-mono text-xs">{r.tokens_in.toLocaleString()} / {r.tokens_out.toLocaleString()}</td>
                  </tr>
                ))}
                {data.by_model.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No AI calls recorded for this workspace{ws.synthetic ? " (the demo was computed in advance)" : ""}.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="font-display mt-8 text-xl font-semibold text-ink">Recent runs</h2>
          <div className="stagger mt-3 space-y-3">
            {data.runs.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === "done" ? "bg-verified-soft text-verified" : r.status === "failed" ? "bg-missing-soft text-missing" : "bg-amber-soft text-amber-ink"}`}>
                    {r.status === "done" ? <Check className="h-3 w-3" /> : r.status === "failed" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />} {r.status}
                  </span>
                  <Pill>{r.frozen ? "precomputed demo" : r.mode === "refresh" ? "refresh" : "full run"}</Pill>
                  {r.inherited && <Pill>from the demo template</Pill>}
                  <span className="text-muted">{r.started_at?.slice(0, 16).replace("T", " ")} · {fmtDur(r.duration_s)}</span>
                </div>
                {r.error && <p className="mt-2 text-sm text-missing">{r.error}</p>}
                <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  {r.steps.map((s) => (
                    <li key={s.step} className="flex gap-2">
                      <span className={s.status === "done" ? "text-verified" : s.status === "failed" ? "text-missing" : "text-muted"}>{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "○"}</span>
                      <span><span className="font-medium text-ink">{s.label}</span>{s.message ? <span className="text-muted"> · {s.message}</span> : null}{s.issues ? <span className="text-conflicting"> · {s.issues} issue(s)</span> : null}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

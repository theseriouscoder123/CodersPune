"use client";

import { Activity, AlertTriangle, ArrowLeft, Check, Clock, Cpu, Gauge, X } from "lucide-react";

import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, ButtonLink, Card, PageHeader, Pill, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/useApi";

type Health = {
  config: { provider: string; configured: boolean; verifier: string; extract_models: string[]; verify_models: string[]; keys?: Record<string, number> };
  totals: { calls: number; failed: number; failure_rate: number; daily_quota_hits: number; tokens: number };
  by_model: { purpose: string; model: string; calls: number; ok: number; failed: number; errors: Record<string, number>; tokens_in: number; tokens_out: number; p50_ms: number | null; p95_ms: number | null }[];
  runs: { id: string; status: string; mode: string; frozen: boolean; started_at: string | null; duration_s: number | null; error: string | null; inherited: boolean;
    steps: { step: string; label: string; status: string; message: string | null; issues: number }[] }[];
};

const PURPOSE: Record<string, string> = { extract: "Claim extraction", verify: "Independent verification", cover: "Checklist coverage", ask: "Ask the handover", smoke: "Smoke test" };

function Stat({ icon, label, value, tone = "" }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-[12px] text-fg-3">{icon} {label}</p>
      <p className={`mt-1 text-[26px] font-semibold leading-8 tracking-[-0.02em] ${tone || "text-fg"}`}>{value}</p>
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
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={<Activity className="h-3.5 w-3.5" />} label="AI calls" value={data.totals.calls} />
            <Stat icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Failed (retried)" value={`${Math.round(data.totals.failure_rate * 100)}%`} tone={data.totals.failure_rate > 0.3 ? "text-con" : ""} />
            <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Daily-quota fallbacks" value={data.totals.daily_quota_hits} />
            <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="Tokens" value={data.totals.tokens.toLocaleString()} />
          </div>

          <Card className="mt-5 p-5">
            <p className="font-semibold text-fg">Configuration</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-fg-2">
              <span>Providers: {data.config.configured ? <Pill className="ml-1 text-ver">configured</Pill> : <Pill className="ml-1 text-mis">not configured</Pill>}
                {Object.entries(data.config.keys ?? {}).filter(([, n]) => n > 0).map(([p, n]) => (
                  <Pill key={p} className="ml-1">{p} · {n} key{n === 1 ? "" : "s"}</Pill>
                ))}</span>
              <span>Extraction chain: {data.config.extract_models.map((m) => <Pill key={m} className="ml-1 font-mono">{m}</Pill>)}</span>
              <span>Verifier chain: {data.config.verify_models.map((m) => <Pill key={m} className="ml-1 font-mono">{m}</Pill>)}</span>
            </div>
            <p className="mt-2 text-[12px] text-fg-3">Calls rotate across each provider&apos;s keys; a rate-limited key hands over to the next one, and when every key for a model is out the next model in the chain takes over. Failed calls are retried with backoff; a batch that still fails is reported, never silently dropped.</p>
          </Card>

          <h2 className="mt-8 text-[16px] font-semibold text-fg">Calls by purpose and model</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-bg-side/60 text-[12px] text-fg-3">
                <tr><th className="px-4 py-2.5">Purpose</th><th className="px-4">Model</th><th className="px-4">Calls</th><th className="px-4">OK</th><th className="px-4">Failed</th><th className="px-4">Top errors</th><th className="px-4">Latency p50 / p95</th><th className="px-4">Tokens in / out</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.by_model.map((r) => (
                  <tr key={r.purpose + r.model}>
                    <td className="px-4 py-2.5 font-medium text-fg">{PURPOSE[r.purpose] ?? r.purpose}</td>
                    <td className="px-4 font-mono text-[12px]">{r.model}</td>
                    <td className="px-4">{r.calls}</td>
                    <td className="px-4 text-ver">{r.ok}</td>
                    <td className={`px-4 ${r.failed ? "text-con" : "text-fg-3"}`}>{r.failed}</td>
                    <td className="px-4 text-[12px] text-fg-3">{Object.entries(r.errors).map(([k, n]) => `${k} ×${n}`).join(", ") || "–"}</td>
                    <td className="px-4 font-mono text-[12px]">{fmtMs(r.p50_ms)} / {fmtMs(r.p95_ms)}</td>
                    <td className="px-4 font-mono text-[12px]">{r.tokens_in.toLocaleString()} / {r.tokens_out.toLocaleString()}</td>
                  </tr>
                ))}
                {data.by_model.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-fg-3">No AI calls recorded for this workspace{ws.synthetic ? " (the demo was computed in advance)" : ""}.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 text-[16px] font-semibold text-fg">Recent runs</h2>
          <div className="mt-3 space-y-3">
            {data.runs.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${r.status === "done" ? "bg-ver-soft text-ver" : r.status === "failed" ? "bg-mis-soft text-mis" : "bg-accent-soft text-accent-ink"}`}>
                    {r.status === "done" ? <Check className="h-3 w-3" /> : r.status === "failed" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />} {r.status}
                  </span>
                  <Pill>{r.frozen ? "precomputed demo" : r.mode === "refresh" ? "refresh" : "full run"}</Pill>
                  {r.inherited && <Pill>from the demo template</Pill>}
                  <span className="text-fg-3">{r.started_at?.slice(0, 16).replace("T", " ")} · {fmtDur(r.duration_s)}</span>
                </div>
                {r.error && <p className="mt-2 text-[13px] text-mis">{r.error}</p>}
                <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                  {r.steps.map((s) => (
                    <li key={s.step} className="flex gap-2">
                      <span className={s.status === "done" ? "text-ver" : s.status === "failed" ? "text-mis" : "text-fg-3"}>{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "○"}</span>
                      <span><span className="font-medium text-fg">{s.label}</span>{s.message ? <span className="text-fg-3"> · {s.message}</span> : null}{s.issues ? <span className="text-con"> · {s.issues} issue(s)</span> : null}</span>
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

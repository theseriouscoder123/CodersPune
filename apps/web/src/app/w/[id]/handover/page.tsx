"use client";

import { AlertTriangle, ArrowRight, Download, FileText, HelpCircle, History, Hourglass, Lock, Network, Rocket, Users, X } from "lucide-react";
import { useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { EvidenceCard } from "@/components/ledger/EvidenceCard";
import { STATUS_META, StatusChip } from "@/components/ledger/StatusChip";
import { Avatar, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, Card, Drawer, EmptyState, SkeletonList, Spinner } from "@/components/ui";
import { api, type EvidenceInfo, type HandoverItem, type HandoverRef, type HandoverView } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const SECTION_META: Record<string, { Icon: typeof Rocket; tone: string; accent: string }> = {
  start_here: { Icon: Rocket, tone: "bg-amber-soft text-amber-ink", accent: "border-amber/30" },
  owners: { Icon: Users, tone: "bg-supported-soft text-supported", accent: "border-line" },
  decisions: { Icon: FileText, tone: "bg-paper-2 text-ink", accent: "border-line" },
  risks: { Icon: AlertTriangle, tone: "bg-conflicting-soft text-conflicting", accent: "border-conflicting/25" },
  dependencies: { Icon: Network, tone: "bg-supported-soft text-supported", accent: "border-line" },
  unresolved: { Icon: HelpCircle, tone: "bg-missing-soft text-missing", accent: "border-missing/25" },
};

type Versions = { versions: { version: number; approved_by: string; approved_at: string; note: string | null; items: number; added: number; removed: number }[] };

export default function HandoverPage() {
  const { ws } = useWorkspace();
  const ref = useApi<{ handover: HandoverRef | null }>(`/workspaces/${ws.id}/handover`);
  const hid = ref.data?.handover?.id;
  const view = useApi<HandoverView>(hid ? `/handovers/${hid}` : null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  const versions = useApi<Versions>(hid && isReviewer ? `/handovers/${hid}/versions` : null);
  const [drawer, setDrawer] = useState<{ item: HandoverItem; evidence: EvidenceInfo[] | null; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  if (ref.data && !ref.data.handover) return <EmptyState title="No handover set up">This workspace has no successor yet.</EmptyState>;
  if (view.status === 403) return <div className="mx-auto max-w-lg pt-6"><EmptyState icon={<Lock className="h-5 w-5" />} title="Not shared with you">{view.error}</EmptyState></div>;
  if (view.loading || ref.loading || !view.data) return view.error ? <Alert tone="error">{view.error}</Alert> : <SkeletonList rows={4} />;
  const v = view.data;

  async function openEvidence(item: HandoverItem) {
    setDrawer({ item, evidence: null });
    try {
      const ev = await Promise.all(item.evidence.map((e) => api<EvidenceInfo>(`/handovers/${hid}/evidence/${e.evidence_id}`, { workspaceId: ws.id })));
      setDrawer({ item, evidence: ev });
    } catch (e) {
      setDrawer({ item, evidence: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function exportMd(version: number) {
    setExporting(true);
    try {
      const r = await fetch(`/api/handovers/${hid}/export.md`, { headers: { "X-Baton-Persona": ws.persona.id } });
      const blob = new Blob([await r.text()], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `handover-v${version}.md`;
      a.click();
    } finally {
      setExporting(false);
    }
  }

  const leaver = ws.members.find((m) => m.roles.includes("leaver"));
  const successor = ws.members.find((m) => m.roles.includes("successor"));

  return (
    <div>
      <CoachBar id="handover" step="Step 5 · Handover.">
        This is the approved continuation plan, filtered to what {ws.persona.name} may see. Every item links to its evidence. Items under
        <b> Unresolved</b> have no answer yet, so ask before relying on them.
      </CoachBar>

      {!v.approved ? (
        <div className="mx-auto max-w-lg pt-6" data-testid="handover-pending">
          <EmptyState icon={<Hourglass className="h-5 w-5" />} title={v.message}>
            Nothing reaches the successor until a reviewer approves it.
            {isReviewer ? " Review the claims, preview the successor's view, then approve." : " Check back soon."}
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Document header */}
          <Card className="animate-rise relative overflow-hidden p-6 sm:p-8">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber via-amber/60 to-transparent" />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">Handover · version {v.version}</p>
                <h1 className="font-display mt-2 flex flex-wrap items-center gap-3 text-[30px] font-semibold leading-tight text-ink">
                  {leaver && <Avatar m={leaver} size={34} />} {v.leaver} <ArrowRight className="h-5 w-5 text-muted" /> {successor && <Avatar m={successor} size={34} />} {v.successor}
                </h1>
                <p className="mt-2 text-sm text-muted" data-testid="handover-meta">
                  Approved by <b className="text-ink-2">{v.approved_by}</b> on {v.approved_at.slice(0, 10)}{v.note ? ` · “${v.note}”` : ""} · viewing as {ws.persona.name}
                </p>
              </div>
              <Button variant="secondary" loading={exporting} onClick={() => exportMd(v.version)}><Download className="h-4 w-4" /> Export Markdown</Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {v.sections.map((s) => {
                const meta = SECTION_META[s.key];
                return (
                  <a key={s.key} href={`#${s.key}`} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition hover:brightness-95 ${meta.tone}`}>
                    <meta.Icon className="h-3.5 w-3.5" /> {s.title} <b>{s.items.length}</b>
                  </a>
                );
              })}
            </div>
          </Card>

          <div className="stagger mt-6 grid gap-5 lg:grid-cols-2" data-testid="handover-sections">
            {v.sections.map((s) => {
              const meta = SECTION_META[s.key];
              return (
                <section key={s.key} id={s.key} data-section={s.key}
                  className={`scroll-mt-40 rounded-2xl border bg-card p-5 shadow-[var(--shadow-sm)] ${meta.accent} ${s.key === "start_here" ? "lg:col-span-2" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-9 w-9 place-items-center rounded-xl ${meta.tone}`}><meta.Icon className="h-4.5 w-4.5" strokeWidth={2} /></span>
                    <div>
                      <h2 className="font-display text-lg font-semibold text-ink">{s.title} <span className="text-sm font-normal text-muted">({s.items.length})</span></h2>
                      <p className="text-xs text-muted">{s.help}</p>
                    </div>
                  </div>
                  <ul className={`mt-4 grid gap-2 ${s.key === "start_here" ? "md:grid-cols-2" : ""}`}>
                    {s.items.length === 0 && <li className="text-sm text-muted">Nothing here.</li>}
                    {s.items.map((it, i) => it.restricted ? (
                      <li key={`r${i}`} className="flex items-center gap-2 rounded-xl border border-dashed border-line-2 bg-paper/60 px-3 py-2.5 text-sm italic text-muted"><Lock className="h-3.5 w-3.5" /> {it.text}</li>
                    ) : (
                      <li key={it.claim_id} className={`group rounded-xl border border-line bg-paper/40 px-3.5 py-3 transition hover:border-line-2 hover:bg-card ${it.history ? "opacity-70" : ""}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusChip status={it.status} promoted={!!it.flags?.reviewer_confirmed_without_evidence} />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{it.type_label}</span>
                          {it.history && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><History className="h-3 w-3" /> Superseded</span>}
                        </div>
                        <p className={`mt-1.5 text-[14.5px] leading-snug ${it.history ? "text-muted line-through decoration-line-2" : "text-ink"}`}>{it.text}</p>
                        {it.history && it.superseded_by_text && <p className="mt-1 text-xs text-muted">Replaced by: {it.superseded_by_text}</p>}
                        {it.flags?.reviewer_confirmed_without_evidence && <p className="mt-1 text-xs text-muted">Reviewer-confirmed (no source evidence)</p>}
                        {it.status === "missing" && <p className="mt-1.5 text-xs font-medium text-missing">No source answers this. Ask {v.leaver} or the reviewer.</p>}
                        {it.evidence.length > 0 && (
                          <button onClick={() => openEvidence(it)} data-testid="source-ref"
                            className="mt-2 inline-flex max-w-full items-center gap-1 text-left font-mono text-[11px] text-supported hover:underline">
                            <span className="truncate">{it.evidence.map((e) => e.ref).join(" · ")}</span> <ArrowRight className="h-3 w-3 shrink-0 transition group-hover:translate-x-0.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {versions.data && versions.data.versions.length > 0 && (
            <section className="mt-8" data-testid="versions">
              <h2 className="font-display flex items-center gap-2 text-lg font-semibold text-ink"><History className="h-4 w-4" /> Version history</h2>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-paper/60 text-xs uppercase tracking-wider text-muted">
                    <tr><th className="px-4 py-2.5">Version</th><th className="px-4">Approved by</th><th className="px-4">When</th><th className="px-4">Items</th><th className="px-4">Change</th><th className="px-4">Note</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {versions.data.versions.map((x) => (
                      <tr key={x.version}>
                        <td className="px-4 py-2.5 font-semibold text-ink">v{x.version}</td><td className="px-4">{x.approved_by}</td>
                        <td className="px-4 font-mono text-xs">{x.approved_at.slice(0, 16).replace("T", " ")}</td><td className="px-4">{x.items}</td>
                        <td className="px-4 text-xs"><span className="text-verified">+{x.added}</span> / <span className="text-missing">−{x.removed}</span></td>
                        <td className="px-4 text-muted">{x.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} label="Evidence">
        {drawer && (
          <div className="p-5" data-testid="evidence-drawer">
            <div className="flex items-start justify-between gap-3">
              <div>
                <StatusChip status={drawer.item.status} size="md" />
                <p className="font-display mt-2 text-lg font-medium leading-snug text-ink">{drawer.item.text}</p>
              </div>
              <button onClick={() => setDrawer(null)} className="rounded-lg p-1.5 text-muted hover:bg-paper-2 hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <p className={`mt-3 rounded-xl px-4 py-3 text-sm text-ink-2 ${STATUS_META[drawer.item.status].soft}`}>{drawer.item.status_reason}</p>
            <div className="mt-4 space-y-3">
              {drawer.evidence === null && <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading evidence…</p>}
              {drawer.error && <Alert tone="error">{drawer.error}</Alert>}
              {drawer.evidence?.map((e) => <EvidenceCard key={e.id} e={e} />)}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

"use client";

import { ArrowLeft, Check, Hourglass, MessageCircleQuestion } from "lucide-react";
import { Suspense, useState } from "react";

import { StatusChip } from "@/components/ledger/StatusChip";
import { useHandoverSelection } from "@/components/workspace/HandoverPicker";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, ButtonLink, Card, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import type { Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Item = { claim_id: string; text: string; status: Status; section: string; type_label: string | null; why: string; state: string | null; done: boolean };
type Plan = { approved: boolean; version?: number; successor: string | null; leaver?: string; leaves_on?: string | null; leaver_here?: boolean;
  counts?: { total: number; done: number }; buckets: { key: string; title: string; help: string; items: Item[] }[] };

const SHOW = 6;

export default function FirstWeekPage() {
  return <Suspense fallback={<SkeletonList rows={4} />}><FirstWeekInner /></Suspense>;
}

function FirstWeekInner() {
  const { ws } = useWorkspace();
  const sel = useHandoverSelection();
  const h = sel.selected;
  const plan = useApi<Plan>(h ? `/handovers/${h.id}/first-week` : null);
  const isSuccessor = ws.persona.roles.includes("successor");
  if (!sel.loading && !h) return <EmptyState title="No handover for you yet">There is no handover addressed to {ws.persona.name} in this workspace.</EmptyState>;
  if (plan.status === 403) return <EmptyState title="Not for this person">{plan.error}</EmptyState>;
  const p = plan.data;
  const who = isSuccessor ? "Your" : `${p?.successor ?? "The successor"}'s`;
  const pct = p?.counts?.total ? Math.round((p.counts.done / p.counts.total) * 100) : 0;
  return (
    <div>
      <PageHeader eyebrow="Handover" title={`${who} first week`}
        description="The approved handover, arranged by when to pick each item up. Every item says why it is on that day, and it ticks off when you acknowledge it on the handover."
        actions={h ? <ButtonLink variant="secondary" href={`/w/${ws.id}/handover?h=${h.id}`}><ArrowLeft className="h-4 w-4" /> Back to the handover</ButtonLink> : undefined} />
      {plan.loading && <div className="mt-6"><SkeletonList rows={4} /></div>}
      {plan.error && plan.status !== 403 && <Alert tone="error" className="mt-6">{plan.error}</Alert>}
      {p && !p.approved && <div className="mx-auto max-w-lg pt-6"><EmptyState icon={<Hourglass className="h-5 w-5" />} title="Not approved yet">The plan appears once the reviewer approves the handover.</EmptyState></div>}
      {p?.approved && p.counts && (
        <>
          <Card className="mt-6 p-5" data-testid="first-week-progress">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-xl font-semibold text-ink">{p.counts.done} of {p.counts.total} picked up</p>
              {p.leaves_on && <p className="text-sm text-muted">{p.leaver_here ? `${p.leaver} is around until ${new Date(`${p.leaves_on}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: ask now.` : `${p.leaver} has left; ask the reviewer.`}</p>}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="First-week progress">
              <div className="h-full bg-verified-solid transition-all" style={{ width: `${pct}%` }} />
            </div>
          </Card>
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3" data-testid="first-week">
            {p.buckets.map((b) => <Bucket key={b.key} b={b} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Bucket({ b }: { b: Plan["buckets"][number] }) {
  const [all, setAll] = useState(false);
  const shown = all ? b.items : b.items.slice(0, SHOW);
  const left = b.items.filter((i) => !i.done).length;
  return (
    <section data-testid={`bucket-${b.key}`}>
      <div className="flex items-baseline justify-between border-b border-line-2 pb-2">
        <h2 className="font-display text-lg font-semibold text-ink">{b.title}</h2>
        <span className="text-xs text-muted">{left} to do</span>
      </div>
      <p className="mt-1.5 text-xs text-muted">{b.help}</p>
      <ul className="mt-3 space-y-2">
        {b.items.length === 0 && <li className="text-sm text-muted">Nothing here.</li>}
        {shown.map((i) => (
          <li key={i.claim_id} className={`rounded-xl border bg-card p-3 ${i.done ? "border-line" : "border-line-2"}`} data-done={i.done ? "1" : undefined}>
            <div className="flex items-center gap-2">
              {i.done ? <span className="grid h-5 w-5 place-items-center rounded-full bg-verified-solid text-white"><Check className="h-3 w-3" /></span>
                : i.state === "question" ? <MessageCircleQuestion className="h-4 w-4 text-amber-ink" /> : <StatusChip status={i.status} />}
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{i.section}</span>
            </div>
            <p className={`mt-1.5 text-sm leading-snug ${i.done ? "text-ink-2" : "text-ink"}`}>{i.text}</p>
            <p className="mt-1 text-xs text-muted">{i.state === "question" ? "You asked a question about this. " : ""}{i.why}</p>
          </li>
        ))}
      </ul>
      {b.items.length > SHOW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-supported hover:underline">
          {all ? "Show fewer" : `Show all ${b.items.length}`}
        </button>
      )}
    </section>
  );
}

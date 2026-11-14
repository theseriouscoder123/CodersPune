"use client";

import { ArrowRight, CalendarClock, Check, FileCode2, GitCompareArrows, HelpCircle, ListTodo, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";

import { useToast } from "@/components/Toast";
import { HandoverPicker, useHandoverSelection } from "@/components/workspace/HandoverPicker";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, Card, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Item = { key: string; kind: "task" | "conflict" | "gap" | "walkthrough" | "question"; title: string; detail: string; done: boolean;
  manual: boolean; marked_by: string | null; link: string | null };
type Leaving = { leaver: string; successor: string | null; leaves_on: string | null; days_left: number | null; today: string;
  can_edit_date: boolean; can_mark: boolean; items: Item[]; counts: { total: number; done: number } };

const KIND: Record<Item["kind"], { label: string; Icon: typeof ListTodo }> = {
  task: { label: "Their task", Icon: ListTodo },
  conflict: { label: "Sources disagree", Icon: GitCompareArrows },
  gap: { label: "Nobody has answered", Icon: HelpCircle },
  walkthrough: { label: "Walkthrough needed", Icon: FileCode2 },
  question: { label: "Successor's question", Icon: MessageCircleQuestion },
};

function fmt(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function LeavingPage() {
  return <Suspense fallback={<SkeletonList rows={4} />}><LeavingInner /></Suspense>;
}

function LeavingInner() {
  const { ws } = useWorkspace();
  const sel = useHandoverSelection();
  const h = sel.selected;
  const data = useApi<Leaving>(h ? `/handovers/${h.id}/leaving` : null);
  if (!sel.loading && !h) return <EmptyState title="No handover yet">Start a handover first; this checklist belongs to one.</EmptyState>;
  if (data.status === 403) return <EmptyState title="Not for this person">{data.error}</EmptyState>;
  const d = data.data;
  const open = d ? d.counts.total - d.counts.done : 0;
  return (
    <div>
      <PageHeader eyebrow="Before someone leaves" title={d ? `Before ${d.leaver} leaves` : "Before the leaver leaves"}
        description="Everything that has to happen before the last day, in order: their tasks, conflicts only they can settle, questions nobody has answered, files only they know, and questions from the successor. Items tick themselves off when answered or resolved." />
      <HandoverPicker handovers={sel.handovers} selected={h} onCreated={sel.reload} />
      {data.loading && <div className="mt-6"><SkeletonList rows={4} /></div>}
      {data.error && data.status !== 403 && <Alert tone="error" className="mt-6">{data.error}</Alert>}
      {d && h && (
        <>
          <Countdown d={d} hid={h.id} open={open} onChanged={data.reload} />
          <ol className="mt-6 space-y-2" data-testid="leaving-items">
            {d.items.length === 0 && <li><Card className="p-5 text-sm text-muted">Nothing depends on {d.leaver} alone. Nice.</Card></li>}
            {d.items.map((it, i) => <Row key={it.key} it={it} n={i + 1} hid={h.id} canMark={d.can_mark} onChanged={data.reload} wsId={ws.id} />)}
          </ol>
        </>
      )}
    </div>
  );
}

function Countdown({ d, hid, open, onChanged }: { d: Leaving; hid: string; open: number; onChanged: () => void }) {
  const toast = useToast();
  const { ws } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(d.leaves_on ?? "");
  const pct = d.counts.total ? Math.round((d.counts.done / d.counts.total) * 100) : 100;
  const past = d.days_left !== null && d.days_left < 0;
  const headline = d.days_left === null ? "No last day set"
    : past ? `${d.leaver}'s last day was ${fmt(d.leaves_on!)}`
      : d.days_left === 0 ? "Today is the last day" : `${d.days_left} day${d.days_left === 1 ? "" : "s"} left`;
  async function save() {
    try {
      await api(`/handovers/${hid}/leaving/date`, { workspaceId: ws.id, method: "PUT", body: { leaves_on: value || null } });
      setEditing(false);
      toast("Last day saved");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }
  return (
    <Card className={`mt-6 p-5 ${past && open ? "border-missing/30" : ""}`} data-testid="leaving-countdown">
      <div className="flex flex-wrap items-center gap-4">
        <span className={`grid h-12 w-12 place-items-center rounded-2xl ${past && open ? "bg-missing-soft text-missing" : "bg-amber-soft text-amber-ink"}`}><CalendarClock className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-semibold text-ink">{headline}</p>
          <p className="text-sm text-muted">
            {d.leaves_on && !past ? `Last day ${fmt(d.leaves_on)}. ` : ""}
            {open ? `${open} of ${d.counts.total} still open${past ? `; these now need another owner, or ${d.leaver} on a call.` : "."}` : "Everything is done."}
          </p>
        </div>
        {d.can_edit_date && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{d.leaves_on ? "Change last day" : "Set last day"}</Button>}
        {editing && (
          <div className="flex items-center gap-2">
            <input type="date" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Last day"
              className="h-9 rounded-xl border border-line bg-card px-3 text-sm text-ink" />
            <Button size="sm" onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        )}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Done before the last day">
        <div className="h-full bg-verified-solid transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">{d.counts.done} of {d.counts.total} done</p>
    </Card>
  );
}

function Row({ it, n, hid, canMark, onChanged, wsId }: { it: Item; n: number; hid: string; canMark: boolean; onChanged: () => void; wsId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const k = KIND[it.kind];
  async function toggle() {
    setBusy(true);
    try {
      await api(`/handovers/${hid}/leaving/marks/${encodeURIComponent(it.key)}`, { workspaceId: wsId, method: "POST", body: { done: !it.done } });
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`flex items-start gap-3 rounded-2xl border bg-card p-4 ${it.done ? "border-line opacity-80" : "border-line-2"}`} data-testid="leaving-item" data-kind={it.kind} data-done={it.done ? "1" : undefined}>
      {it.manual && canMark ? (
        <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={it.done} aria-label={it.done ? "Mark as not done" : "Mark as done"} data-testid="leaving-toggle"
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition ${it.done ? "border-verified-solid bg-verified-solid text-white" : "border-line-2 bg-paper hover:border-ink/40"}`}>
          {it.done && <Check className="h-4 w-4" />}
        </button>
      ) : (
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${it.done ? "bg-verified-solid text-white" : "bg-paper-2 text-muted"}`}>{it.done ? <Check className="h-4 w-4" /> : n}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted"><k.Icon className="h-3.5 w-3.5" /> {k.label}{it.done ? " · done" : ""}</p>
        <p className="mt-1 text-[15px] leading-snug text-ink">{it.title}</p>
        <p className="mt-0.5 text-xs text-muted">{it.detail}{it.done && it.marked_by ? ` Ticked off by ${it.marked_by}.` : ""}</p>
      </div>
      {it.link && <Link href={it.link} className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-supported hover:underline">Open <ArrowRight className="h-3.5 w-3.5" /></Link>}
    </li>
  );
}

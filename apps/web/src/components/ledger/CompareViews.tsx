"use client";

import { ArrowLeftRight, Lock } from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/ledger/StatusChip";
import { Avatar } from "@/components/workspace/WorkspaceShell";
import { Card, SkeletonList } from "@/components/ui";
import type { HandoverCounts, Member, Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Row = { id: string; text: string; status: Status; type_label: string; history: string | null; reason: string };
type Compare = { a: { name: string; counts: HandoverCounts }; b: { name: string; counts: HandoverCounts }; both: number; only_a: Row[]; only_b: Row[] };

/** Improvement #3, person-to-person visibility diff: of what this version would share, who sees what, and why not. */
export function CompareViews({ hid, members, defaultA, defaultB }: { hid: string; members: Member[]; defaultA: string; defaultB: string }) {
  const [a, setA] = useState(defaultA);
  const [b, setB] = useState(defaultB);
  const same = a === b;
  const cmp = useApi<Compare>(!same ? `/handovers/${hid}/compare?a=${a}&b=${b}` : null);
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} data-testid={`compare-${label === "Person A" ? "a" : "b"}`}
        className="rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-amber/30">
        {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.roles.filter((r) => r !== "member").join(", ") || "member"})</option>)}
      </select>
    </label>
  );
  const nameOf = (id: string) => members.find((m) => m.id === id);
  const column = (title: string, rows: Row[], who: string) => (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title} · {rows.length}</p>
      <ul className="mt-2 space-y-2">
        {rows.length === 0 && <li className="rounded-xl border border-line bg-paper/40 p-3 text-sm text-muted">Nothing. {who} sees all of it too.</li>}
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><StatusChip status={r.status} /><span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{r.type_label}{r.history ? " · history" : ""}</span></div>
            <p className="mt-1.5 text-ink">{r.text}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-missing"><Lock className="h-3 w-3 shrink-0" /> Hidden from {who}: {r.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Card className="mt-8 p-5" data-testid="compare-views">
      <h2 className="flex items-center gap-2 font-semibold text-ink"><ArrowLeftRight className="h-4 w-4" /> Compare what two people see</h2>
      <p className="mt-1 text-sm text-muted">Of the items this version would share, what each person can open and why the other can&apos;t. The same permission rule as everywhere else.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">{pick(a, setA, "Person A")}{pick(b, setB, "Person B")}</div>
      {same && <p className="mt-4 text-sm text-muted">Pick two different people.</p>}
      {!same && cmp.loading && <div className="mt-4"><SkeletonList rows={2} /></div>}
      {!same && cmp.error && <p className="mt-4 text-sm text-missing">{cmp.error}</p>}
      {!same && cmp.data && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center" data-testid="compare-summary">
            <div className="rounded-xl bg-paper-2 p-3"><p className="font-display text-2xl font-semibold text-ink">{cmp.data.both}</p><p className="text-xs text-muted">both see</p></div>
            <div className="rounded-xl bg-supported-soft p-3"><p className="font-display text-2xl font-semibold text-supported">{cmp.data.only_a.length}</p><p className="text-xs text-supported">only {cmp.data.a.name}</p></div>
            <div className="rounded-xl bg-supported-soft p-3"><p className="font-display text-2xl font-semibold text-supported">{cmp.data.only_b.length}</p><p className="text-xs text-supported">only {cmp.data.b.name}</p></div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">{nameOf(a) && <Avatar m={nameOf(a)!} size={22} />}<span className="text-sm font-semibold text-ink">Only {cmp.data.a.name}</span></div>
              {column(`Hidden from ${cmp.data.b.name}`, cmp.data.only_a, cmp.data.b.name)}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">{nameOf(b) && <Avatar m={nameOf(b)!} size={22} />}<span className="text-sm font-semibold text-ink">Only {cmp.data.b.name}</span></div>
              {column(`Hidden from ${cmp.data.a.name}`, cmp.data.only_b, cmp.data.a.name)}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

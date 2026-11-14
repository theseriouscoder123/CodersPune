"use client";

import { ArrowLeftRight, Lock } from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/ledger/StatusChip";
import { Avatar } from "@/components/workspace/WorkspaceShell";
import { SkeletonList } from "@/components/ui";
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
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-medium text-fg-3">
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} data-testid={`compare-${label === "Person A" ? "a" : "b"}`}
        className="h-8 rounded-md border border-line bg-bg px-2 text-[13px] text-fg outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--ring)]">
        {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.roles.filter((r) => r !== "member").join(", ") || "member"})</option>)}
      </select>
    </label>
  );
  const nameOf = (id: string) => members.find((m) => m.id === id);
  const column = (title: string, rows: Row[], who: string) => (
    <div className="min-w-0">
      <p className="text-[12px] font-medium text-fg-3">{title} · {rows.length}</p>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
        {rows.length === 0 && <li className="px-3.5 py-3 text-[13px] text-fg-3">Nothing. {who} sees all of it too.</li>}
        {rows.map((r) => (
          <li key={r.id} className="px-3.5 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2"><StatusChip status={r.status} /><span className="text-[12px] text-fg-3">{r.type_label}{r.history ? " · history" : ""}</span></div>
            <p className="mt-1 leading-5 text-fg">{r.text}</p>
            <p className="mt-1 flex items-start gap-1.5 text-[12px] text-mis"><Lock className="h-3 w-3 shrink-0" /> Hidden from {who}: {r.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="mt-12 border-t border-line pt-8" data-testid="compare-views">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-fg"><ArrowLeftRight className="h-4 w-4 text-fg-3" /> Compare what two people see</h2>
      <p className="mt-0.5 text-[12.5px] text-fg-3">Of the items this version would share, what each person can open and why the other can&apos;t. The same permission rule as everywhere else.</p>
      <div className="mt-4 flex max-w-[560px] flex-col gap-3 sm:flex-row">{pick(a, setA, "Person A")}{pick(b, setB, "Person B")}</div>
      {same && <p className="mt-4 text-[13px] text-fg-3">Pick two different people.</p>}
      {!same && cmp.loading && <div className="mt-4"><SkeletonList rows={2} /></div>}
      {!same && cmp.error && <p className="mt-4 text-[13px] text-mis">{cmp.error}</p>}
      {!same && cmp.data && (
        <>
          <div className="mt-4 grid max-w-[560px] grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line" data-testid="compare-summary">
            <div className="px-4 py-3"><p className="text-[22px] font-semibold leading-7 text-fg">{cmp.data.both}</p><p className="text-[12px] text-fg-3">both see</p></div>
            <div className="px-4 py-3"><p className="text-[22px] font-semibold leading-7 text-fg">{cmp.data.only_a.length}</p><p className="text-[12px] text-fg-3">only {cmp.data.a.name}</p></div>
            <div className="px-4 py-3"><p className="text-[22px] font-semibold leading-7 text-fg">{cmp.data.only_b.length}</p><p className="text-[12px] text-fg-3">only {cmp.data.b.name}</p></div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">{nameOf(a) && <Avatar m={nameOf(a)!} size={20} />}<span className="text-[13px] font-semibold text-fg">Only {cmp.data.a.name}</span></div>
              {column(`Hidden from ${cmp.data.b.name}`, cmp.data.only_a, cmp.data.b.name)}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">{nameOf(b) && <Avatar m={nameOf(b)!} size={20} />}<span className="text-[13px] font-semibold text-fg">Only {cmp.data.b.name}</span></div>
              {column(`Hidden from ${cmp.data.a.name}`, cmp.data.only_b, cmp.data.a.name)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

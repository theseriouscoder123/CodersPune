"use client";

import { ArrowRight, GitCompareArrows, History, Hourglass, Scale, Unlink, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { STATUS_META } from "@/components/ledger/StatusChip";
import { useToast } from "@/components/Toast";
import { Button, Drawer, Skeleton } from "@/components/ui";
import { api, type ClaimSummary } from "@/lib/api";

type Node = { id: string; text: string; type: string; status: string; subject_key: string; occurred_at: string | null; refs: string[]; superseded: boolean; stale_reason: string | null };
type Rel = { id: string; relation: "reversal" | "historical" | "contradiction" | "unrelated"; label: string; decided_by: "rule" | "reviewer"; decided_by_name: string | null; signal: string | null; note: string | null; earlier: Node; later: Node };
export type RelationsOut = { relations: Rel[]; stale: Node[]; counts: Record<string, number> };

const REL_META: Record<Rel["relation"], { tone: string; Icon: typeof History; asEarlier: string; asLater: string }> = {
  reversal: { tone: "bg-paper-2 text-ink-2 ring-line-2", Icon: History, asEarlier: "Reversed later", asLater: "Replaces an earlier decision" },
  historical: { tone: "bg-paper-2 text-ink-2 ring-line-2", Icon: History, asEarlier: "Describes an earlier state", asLater: "Current state" },
  contradiction: { tone: "bg-conflicting-soft text-conflicting ring-conflicting/25", Icon: Scale, asEarlier: "Contradicts a later claim", asLater: "Contradicts an earlier claim" },
  unrelated: { tone: "bg-paper-2 text-muted ring-line", Icon: Unlink, asEarlier: "Marked unrelated", asLater: "Marked unrelated" },
};

type Filter = "all" | "changes" | "contradictions" | "stale";

function fmt(iso: string | null) {
  if (!iso) return "Undated";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function DecisionTimeline({ wsId, events, relations, loading, canEdit, onChanged }: {
  wsId: string; events: ClaimSummary[] | undefined; relations: RelationsOut | undefined; loading: boolean; canEdit: boolean; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ rel?: Rel; stale?: Node } | null>(null);

  const byClaim = useMemo(() => {
    const m = new Map<string, { rel: Rel; role: "earlier" | "later" }[]>();
    for (const r of relations?.relations ?? []) {
      for (const role of ["earlier", "later"] as const) {
        const id = r[role].id;
        m.set(id, [...(m.get(id) ?? []), { rel: r, role }]);
      }
    }
    return m;
  }, [relations]);
  const staleById = useMemo(() => new Map((relations?.stale ?? []).map((s) => [s.id, s])), [relations]);

  // Dated events, plus undated claims that take part in a relation or are stale (they describe the current code).
  const rows = useMemo(() => {
    const seen = new Set((events ?? []).map((e) => e.id));
    const extra: Node[] = [];
    for (const r of relations?.relations ?? []) for (const n of [r.earlier, r.later]) if (!seen.has(n.id)) { seen.add(n.id); extra.push(n); }
    for (const s of relations?.stale ?? []) if (!seen.has(s.id)) { seen.add(s.id); extra.push(s); }
    const base = (events ?? []).map((e) => ({ id: e.id, text: e.text, type: e.type_label, status: e.status as string, occurred_at: e.occurred_at, refs: e.source_refs, superseded: !!e.superseded_by }));
    const more = extra.map((n) => ({ id: n.id, text: n.text, type: n.type.replace("_", " "), status: n.status, occurred_at: n.occurred_at, refs: n.refs, superseded: n.superseded }));
    return [...base, ...more].sort((a, b) => (a.occurred_at ?? "9999").localeCompare(b.occurred_at ?? "9999"));
  }, [events, relations]);

  const shown = rows.filter((r) => {
    const rels = byClaim.get(r.id) ?? [];
    if (filter === "changes") return rels.some((x) => x.rel.relation === "reversal" || x.rel.relation === "historical");
    if (filter === "contradictions") return rels.some((x) => x.rel.relation === "contradiction");
    if (filter === "stale") return staleById.has(r.id);
    return true;
  });
  const c = relations?.counts ?? {};
  const FILTERS: [Filter, string, number | undefined][] = [
    ["all", "Everything", rows.length], ["changes", "Changed decisions", (c.reversal ?? 0) + (c.historical ?? 0)],
    ["contradictions", "Contradictions", c.contradiction], ["stale", "Stale open work", c.stale],
  ];

  return (
    <section data-testid="decision-timeline">
      <h2 className="font-display text-xl font-semibold text-ink">Decision timeline</h2>
      <p className="text-sm text-muted">
        In date order. Baton tells a <b className="font-medium text-ink-2">changed decision</b> (one claim replaced another) apart from a
        <b className="font-medium text-ink-2"> contradiction</b> (two sources disagree), and flags open work that later events overtook. Click a label to see why.
      </p>
      <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter the timeline">
        {FILTERS.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} data-testid={`tl-filter-${k}`}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${filter === k ? "bg-strong text-on-strong ring-strong" : "bg-card text-ink-2 ring-line hover:ring-ink/25"}`}>
            {label}{n !== undefined && <span className={`ml-1.5 ${filter === k ? "text-on-strong/70" : "text-muted"}`}>{n}</span>}
          </button>
        ))}
      </div>

      {loading && <div className="mt-5 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
      <ol className="relative mt-5 space-y-1 pl-6" data-testid="timeline">
        <span className="absolute bottom-2 left-[7px] top-2 w-px bg-line-2" aria-hidden />
        {shown.map((e) => {
          const rels = byClaim.get(e.id) ?? [];
          const stale = staleById.get(e.id);
          return (
            <li key={e.id} className="relative rounded-xl px-3 py-2.5 transition hover:bg-card">
              <span className={`absolute -left-[22px] top-4 h-3 w-3 rounded-full ring-4 ring-paper ${e.superseded || stale ? "bg-line-2" : STATUS_META[e.status as keyof typeof STATUS_META]?.dot ?? "bg-amber"}`} />
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span className={e.occurred_at ? "" : "italic"}>{e.occurred_at ? fmt(e.occurred_at) : "Undated (current code or docs)"}</span><span>·</span>
                <span className="capitalize">{e.type}</span>
                {e.refs.length > 0 && <><span>·</span><span className="truncate text-supported">{e.refs.join(", ")}</span></>}
              </p>
              <Link href={`/w/${wsId}/review?tab=${e.superseded ? "superseded" : "all"}&claim=${e.id}`} title="Open this claim and its evidence"
                className={`mt-0.5 block text-[14.5px] hover:underline ${e.superseded || stale ? "text-muted line-through decoration-line-2" : "text-ink"}`}>{e.text}</Link>
              {(rels.length > 0 || stale) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {rels.map(({ rel, role }) => {
                    const m = REL_META[rel.relation];
                    return (
                      <button key={rel.id + role} onClick={() => setOpen({ rel })} data-testid="relation-chip"
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition hover:brightness-95 ${m.tone}`}>
                        <m.Icon className="h-3 w-3" /> {role === "earlier" ? m.asEarlier : m.asLater}
                        {rel.decided_by === "reviewer" && <span className="opacity-70">· reviewer</span>}
                      </button>
                    );
                  })}
                  {stale && (
                    <button onClick={() => setOpen({ stale })} data-testid="stale-chip"
                      className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2.5 py-0.5 text-xs font-medium text-amber-ink ring-1 ring-amber/30 hover:brightness-95">
                      <Hourglass className="h-3 w-3" /> Probably done or parked
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!loading && shown.length === 0 && <li className="text-sm text-muted">{filter === "all" ? "No dated decisions yet." : "Nothing in this view."}</li>}
      </ol>

      <Drawer open={!!open} onClose={() => setOpen(null)} label="Why these claims relate">
        {open?.rel && <RelationDetail rel={open.rel} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={onChanged} wsId={wsId} />}
        {open?.stale && <StaleDetail node={open.stale} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={onChanged} wsId={wsId} />}
      </Drawer>
    </section>
  );
}

function ClaimBox({ title, n, dateLabel }: { title: string; n: Node; dateLabel?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title} · {dateLabel ? `${dateLabel} ` : ""}{fmt(n.occurred_at)}</p>
      <p className="mt-1 text-sm text-ink">{n.text}</p>
      {n.refs.length > 0 && <p className="mt-1 font-mono text-[11px] text-supported">{n.refs.join(" · ")}</p>}
    </div>
  );
}

function DrawerHead({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/95 px-5 py-4 backdrop-blur">
      <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink">{icon} {title}</p>
      <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-paper-2 hover:text-ink"><X className="h-4 w-4" /></button>
    </div>
  );
}

function RelationDetail({ rel, canEdit, onClose, onChanged, wsId }: { rel: Rel; canEdit: boolean; onClose: () => void; onChanged: () => void; wsId: string }) {
  const toast = useToast();
  const [choice, setChoice] = useState<"reversal" | "contradiction" | "unrelated">(rel.relation === "historical" ? "reversal" : rel.relation === "unrelated" ? "unrelated" : rel.relation);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const m = REL_META[rel.relation];
  const title = { reversal: "A changed decision", historical: "An earlier state", contradiction: "A contradiction", unrelated: "Not related" }[rel.relation];

  async function save() {
    setBusy(true);
    try {
      await api(`/claim-relations/${rel.id}`, { workspaceId: wsId, method: "PATCH", body: { relation: choice, note: note.trim() || null } });
      toast(choice === "reversal" ? "Recorded as a changed decision. The earlier claim is now history"
        : choice === "contradiction" ? "Recorded as a contradiction. Resolve it in Review" : "Recorded as unrelated");
      onChanged();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="relation-detail">
      <DrawerHead icon={<m.Icon className="h-4 w-4 text-amber-ink" />} title={title} onClose={onClose} />
      <div className="space-y-4 p-5">
        <div className="grid gap-2">
          {rel.relation === "historical" ? (
            <>
              <ClaimBox title="Past state" dateLabel="mentioned" n={rel.earlier} />
              <div className="flex justify-center text-muted"><GitCompareArrows className="h-4 w-4" /></div>
              <ClaimBox title="Current state" n={rel.later} />
            </>
          ) : (
            <>
              <ClaimBox title="Earlier" n={rel.earlier} />
              <div className="flex justify-center text-muted"><GitCompareArrows className="h-4 w-4" /></div>
              <ClaimBox title={rel.relation === "contradiction" ? "Later" : "Later (current)"} n={rel.later} />
            </>
          )}
        </div>
        <div className="rounded-xl bg-paper-2 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Why {rel.decided_by === "reviewer" ? `${rel.decided_by_name ?? "the reviewer"} decided this` : "Baton decided this"}</p>
          <p className="mt-1 text-ink-2">{rel.decided_by === "reviewer" ? (rel.note || "Set by the reviewer.") : rel.signal}</p>
          {rel.decided_by === "reviewer" && rel.signal && <p className="mt-2 text-xs text-muted">Baton&apos;s rule had said: {rel.signal}</p>}
          {rel.decided_by === "rule" && <p className="mt-2 text-xs text-muted">Decided by fixed rules, not by the AI.</p>}
        </div>
        {canEdit ? (
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm font-semibold text-ink">Is that right?</p>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="How these claims relate">
              {([["reversal", "Changed decision", "The later one replaces the earlier one"], ["contradiction", "Contradiction", "They disagree: decide in Review"],
                ["unrelated", "Unrelated", "Grouped by mistake"]] as const).map(([k, label, help]) => (
                <button key={k} role="radio" aria-checked={choice === k} onClick={() => setChoice(k)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${choice === k ? "border-amber bg-amber-soft/50" : "border-line hover:border-line-2"}`}>
                  <span className="block font-medium text-ink">{label}</span>
                  <span className="block text-[11px] text-muted">{help}</span>
                </button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why? (shown in the activity log)"
              className="mt-2 h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-amber" />
            <div className="mt-2 flex justify-end">
              <Button size="sm" loading={busy} onClick={() => void save()} data-testid="save-relation">Save</Button>
            </div>
          </div>
        ) : <p className="text-xs text-muted">Only the reviewer can change how these claims relate.</p>}
        <p className="flex items-center gap-1 text-xs text-muted"><ArrowRight className="h-3 w-3" /> A reviewer&apos;s choice is kept when the pipeline runs again.</p>
      </div>
    </div>
  );
}

function StaleDetail({ node, canEdit, onClose, onChanged, wsId }: { node: Node; canEdit: boolean; onClose: () => void; onChanged: () => void; wsId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function stillOpen() {
    setBusy(true);
    try {
      await api(`/claims/${node.id}/stale`, { workspaceId: wsId, method: "POST", body: { still_open: true } });
      toast("Kept as open work. It goes back into Start here");
      onChanged();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="stale-detail">
      <DrawerHead icon={<Hourglass className="h-4 w-4 text-amber-ink" />} title="Probably done or parked" onClose={onClose} />
      <div className="space-y-4 p-5">
        <ClaimBox title="Open work" n={node} />
        <div className="rounded-xl bg-paper-2 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Why Baton thinks so</p>
          <p className="mt-1 text-ink-2">{node.stale_reason}</p>
          <p className="mt-2 text-xs text-muted">The successor sees this as history instead of a next step. Decided by fixed rules, not by the AI.</p>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void stillOpen()} data-testid="still-open">It&apos;s still open</Button>
          </div>
        )}
      </div>
    </div>
  );
}

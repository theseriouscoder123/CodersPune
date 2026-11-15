"use client";

import { ArrowDown, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useToast } from "@/components/Toast";
import { Button, Drawer, IconButton, Skeleton } from "@/components/ui";
import { staleTag } from "@/lib/stale";
import { api, type ClaimSummary } from "@/lib/api";

type Node = { id: string; text: string; type: string; status: string; subject_key: string; occurred_at: string | null; refs: string[]; superseded: boolean; stale_reason: string | null };
type Rel = { id: string; relation: "reversal" | "historical" | "contradiction" | "unrelated"; label: string; decided_by: "rule" | "reviewer"; decided_by_name: string | null; signal: string | null; note: string | null; earlier: Node; later: Node;
  /** set when a reviewer resolved this contradiction in Verify */
  resolution?: { winner?: string; kept_as_risk?: boolean; by?: string | null } | null };
export type RelationsOut = { relations: Rel[]; stale: Node[]; counts: Record<string, number> };

type Filter = "all" | "changes" | "contradictions" | "stale";
const FIRST = 10;

function fmt(iso: string | null) {
  if (!iso) return "Undated";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
const short = (s: string, n = 90) => { const t = s.replace(/[.\s]+$/, ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** What one relation says about one of its two claims, in plain words. */
function explain(rel: Rel, role: "earlier" | "later") {
  const other = role === "earlier" ? rel.later : rel.earlier;
  const self = role === "earlier" ? rel.earlier : rel.later;
  if (rel.relation === "reversal") return role === "earlier" ? { tag: "Changed decision", text: `Replaced${other.occurred_at ? ` on ${fmt(other.occurred_at)}` : ""} by “${short(other.text, 70)}”. Kept as history, not treated as a contradiction.` } : { tag: "Changed decision", text: `Replaces an earlier decision: “${short(other.text, 70)}”.` };
  if (rel.relation === "historical") return role === "earlier" ? { tag: "Earlier state", text: `Describes how things were before${other.occurred_at ? ` ${fmt(other.occurred_at)}` : ""}${self.occurred_at ? ` (written down ${fmt(self.occurred_at)})` : ""}. Current state: “${short(other.text, 70)}”.` } : { tag: "Current state", text: `An earlier claim describes how it used to be: “${short(other.text, 70)}”.` };
  if (rel.relation === "contradiction" && rel.resolution?.kept_as_risk) return { tag: "Kept as a risk", text: `Disagrees with “${short(other.text, 70)}”. ${rel.resolution.by ?? "The reviewer"} kept both as an open risk for the successor.` };
  if (rel.relation === "contradiction" && rel.resolution?.winner) return rel.resolution.winner === self.id
    ? { tag: "Resolved", text: `${rel.resolution.by ?? "The reviewer"} kept this over “${short(other.text, 70)}”.` }
    : { tag: "Resolved", text: `${rel.resolution.by ?? "The reviewer"} chose “${short(other.text, 70)}” instead. Kept as history.` };
  if (rel.relation === "contradiction") return { tag: "Contradiction", text: `Disagrees with “${short(other.text, 80)}”. Both can't be true.` };
  return { tag: "Unrelated", text: "A reviewer marked these as unrelated." };
}

export function DecisionTimeline({ wsId, events, relations, loading, canEdit, onChanged }: {
  wsId: string; events: ClaimSummary[] | undefined; relations: RelationsOut | undefined; loading: boolean; canEdit: boolean; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ rel?: Rel; stale?: Node } | null>(null);
  const [all, setAll] = useState(false);

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

  // earlier-state claim id -> the claim describing the current state (from "historical" relations)
  const pastOf = useMemo(() => {
    const m = new Map<string, Node>();
    for (const r of relations?.relations ?? []) if (r.relation === "historical" && r.later.occurred_at) m.set(r.earlier.id, r.later);
    return m;
  }, [relations]);

  // Dated events, plus undated claims that take part in a relation or are stale (they describe the current code).
  const rows = useMemo(() => {
    const seen = new Set((events ?? []).map((e) => e.id));
    const extra: Node[] = [];
    for (const r of relations?.relations ?? []) for (const n of [r.earlier, r.later]) if (!seen.has(n.id)) { seen.add(n.id); extra.push(n); }
    for (const s of relations?.stale ?? []) if (!seen.has(s.id)) { seen.add(s.id); extra.push(s); }
    const base = (events ?? []).map((e) => ({ id: e.id, text: e.text, type: e.type_label, status: e.status as string, occurred_at: e.occurred_at, refs: e.source_refs, superseded: !!e.superseded_by }));
    const more = extra.map((n) => ({ id: n.id, text: n.text, type: n.type.replaceAll("_", " "), status: n.status, occurred_at: n.occurred_at, refs: n.refs, superseded: n.superseded }));
    // An "earlier state" claim is dated by when it was written down, which can be after the change it describes.
    // Place it just before the claim that replaced it, so the timeline never reads backwards.
    const key = (r: { id: string; occurred_at: string | null }) => pastOf.get(r.id)?.occurred_at ?? r.occurred_at ?? "9999";
    return [...base, ...more].sort((a, b) => key(a).localeCompare(key(b)) || Number(pastOf.has(b.id)) - Number(pastOf.has(a.id)));
  }, [events, relations, pastOf]);

  const shown = rows.filter((r) => {
    const rels = byClaim.get(r.id) ?? [];
    if (filter === "changes") return rels.some((x) => x.rel.relation === "reversal" || x.rel.relation === "historical");
    if (filter === "contradictions") return rels.some((x) => x.rel.relation === "contradiction" && !x.rel.resolution);
    if (filter === "stale") return staleById.has(r.id);
    return true;
  });
  const c = relations?.counts ?? {};
  const FILTERS: [Filter, string, number | undefined][] = [
    ["all", "All", rows.length], ["changes", "Changed decisions", (c.reversal ?? 0) + (c.historical ?? 0)],
    ["contradictions", "Contradictions", c.contradiction], ["stale", "Done, parked or updated", c.stale],
  ];
  const collapsed = filter === "all" && !all && shown.length > FIRST + 2;

  return (
    <section data-testid="decision-timeline">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg">Decision timeline <span className="ml-1 text-[13px] font-normal text-fg-3">{rows.length} events</span></h2>
      <p className="mt-0.5 max-w-[640px] text-[12.5px] leading-[18px] text-fg-3">
        In date order. Baton tells a <b className="font-medium text-fg-2">changed decision</b> apart from a <b className="font-medium text-fg-2">contradiction</b>,
        and flags open work that later events probably finished. Click a note to see why.
      </p>
      <div className="mt-3 flex flex-wrap gap-0.5" role="tablist" aria-label="Filter the timeline">
        {FILTERS.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} data-testid={`tl-filter-${k}`}
            className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors ${filter === k ? "bg-active text-fg" : "text-fg-3 hover:bg-hover hover:text-fg"}`}>
            {label}{n !== undefined && <span className={`text-[12px] ${k === "contradictions" && n ? "text-con" : "text-fg-3"}`}>{n}</span>}
          </button>
        ))}
      </div>

      {loading && <div className="mt-4 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
      <ol className="mt-4" data-testid="timeline">
        {shown.map((e, i) => {
          const rels = byClaim.get(e.id) ?? [];
          const stale = staleById.get(e.id);
          const contra = rels.some((x) => x.rel.relation === "contradiction" && !x.rel.resolution);
          const muted = e.superseded || !!stale;
          return (
            <li key={e.id} className={`grid grid-cols-[78px_20px_minmax(0,1fr)] sm:grid-cols-[92px_24px_minmax(0,1fr)] ${collapsed && i >= FIRST ? "hidden" : ""}`}>
              <span className="pr-2 pt-[3px] text-right font-mono text-[11.5px] text-fg-3">
                {pastOf.has(e.id)
                  ? <><span className="block font-sans text-[11px]">before</span>{pastOf.get(e.id)!.occurred_at!.slice(0, 10)}</>
                  : e.occurred_at ? e.occurred_at.slice(0, 10) : "undated"}
              </span>
              <span className="relative flex justify-center" aria-hidden>
                <span className="absolute inset-y-0 w-px bg-line" />
                <span className={`relative mt-[6px] h-[9px] w-[9px] rounded-full border-[1.5px] bg-bg ${contra ? "border-con" : muted ? "border-fg-4" : "border-fg-3"}`} />
              </span>
              <div className="min-w-0 pb-5 pl-1">
                <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-fg-3">
                  <span className="capitalize">{e.type}</span>
                  {e.refs.length > 0 && <span className="min-w-0 truncate font-mono text-[11.5px] text-accent-ink">· {e.refs.join(" · ")}</span>}
                </p>
                <Link href={`/w/${wsId}/review?tab=${e.superseded ? "superseded" : "all"}&claim=${e.id}`} title="Open this claim and its evidence"
                  className={`mt-0.5 block text-[14px] leading-[21px] hover:underline ${muted ? "text-fg-3" : "text-fg"}`}>{e.text}</Link>
                {rels.map(({ rel, role }) => {
                  const x = explain(rel, role);
                  const isContra = rel.relation === "contradiction" && !rel.resolution;
                  return (
                    <button key={rel.id + role} type="button" onClick={() => setOpen({ rel })} data-testid="relation-chip"
                      className={`mt-2 flex w-full flex-wrap items-start gap-x-3 gap-y-1 rounded-md border sm:flex-nowrap px-3 py-2 text-left transition-colors hover:bg-hover ${isContra ? "border-con/30" : "border-line"}`}>
                      <span className={`mt-px shrink-0 rounded-[4px] px-1.5 text-[10.5px] font-semibold uppercase leading-[18px] tracking-wide ${isContra ? "bg-con-soft text-con" : "bg-hover text-fg-2"}`}>{x.tag}</span>
                      <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg-2 max-sm:order-last max-sm:basis-full">{x.text}</span>
                      <span className="shrink-0 text-[12px] text-fg-3 max-sm:ml-auto">{rel.decided_by === "reviewer" ? <>by {rel.decided_by_name ?? "the reviewer"} <span>· reviewer</span></> : "by rule"}</span>
                      <span className="shrink-0 text-[12px] font-medium text-accent-ink">{isContra ? "Why?" : canEdit ? "Change" : "Why?"}</span>
                    </button>
                  );
                })}
                {stale && (
                  <button type="button" onClick={() => setOpen({ stale })} data-testid="stale-chip"
                    className="mt-2 flex w-full flex-wrap items-start gap-x-3 gap-y-1 rounded-md border sm:flex-nowrap border-line px-3 py-2 text-left transition-colors hover:bg-hover">
                    <span className="mt-px shrink-0 rounded-[4px] bg-hover px-1.5 text-[10.5px] font-semibold uppercase leading-[18px] tracking-wide text-fg-2">{staleTag(stale.stale_reason)}</span>
                    <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg-2 max-sm:order-last max-sm:basis-full">{stale.stale_reason}</span>
                    <span className="shrink-0 text-[12px] text-fg-3 max-sm:ml-auto">by rule</span>
                    <span className="shrink-0 text-[12px] font-medium text-accent-ink">Why?</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {!loading && shown.length === 0 && <li className="pl-[116px] text-[13px] text-fg-3">{filter === "all" ? "No dated decisions yet." : "Nothing in this view."}</li>}
      </ol>
      {collapsed && (
        <button type="button" onClick={() => setAll(true)} className="ml-[116px] inline-flex items-center gap-1 text-[12.5px] text-fg-3 hover:text-fg">
          <ArrowDown className="h-3 w-3" /> Show {shown.length - FIRST} more events
        </button>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} label="Why these claims relate">
        {open?.rel && <RelationDetail rel={open.rel} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={onChanged} wsId={wsId} />}
        {open?.stale && <StaleDetail node={open.stale} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={onChanged} wsId={wsId} />}
      </Drawer>
    </section>
  );
}

function ClaimBox({ title, n, dateLabel }: { title: string; n: Node; dateLabel?: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-[12px] text-fg-3">{title} · {dateLabel ? `${dateLabel} ` : ""}{fmt(n.occurred_at)}</p>
      <p className="mt-1 text-[13px] leading-5 text-fg">{n.text}</p>
      {n.refs.length > 0 && <p className="mt-1 font-mono text-[11.5px] text-accent-ink">{n.refs.join(" · ")}</p>}
    </div>
  );
}

function DrawerHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg px-5 py-3">
      <p className="text-[14px] font-semibold text-fg">{title}</p>
      <IconButton onClick={onClose} aria-label="Close"><X /></IconButton>
    </div>
  );
}

function RelationDetail({ rel, canEdit, onClose, onChanged, wsId }: { rel: Rel; canEdit: boolean; onClose: () => void; onChanged: () => void; wsId: string }) {
  const toast = useToast();
  const [choice, setChoice] = useState<"reversal" | "contradiction" | "unrelated">(rel.relation === "historical" ? "reversal" : rel.relation === "unrelated" ? "unrelated" : rel.relation);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const title = { reversal: "A changed decision", historical: "An earlier state", contradiction: "A contradiction", unrelated: "Not related" }[rel.relation];

  async function save() {
    setBusy(true);
    try {
      await api(`/claim-relations/${rel.id}`, { workspaceId: wsId, method: "PATCH", body: { relation: choice, note: note.trim() || null } });
      toast(choice === "reversal" ? "Recorded as a changed decision. The earlier claim is now history"
        : choice === "contradiction" ? "Recorded as a contradiction. Resolve it in Verify" : "Recorded as unrelated");
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
      <DrawerHead title={title} onClose={onClose} />
      <div className="space-y-4 p-5">
        <div className="grid gap-2">
          {rel.relation === "historical" ? (
            <>
              <ClaimBox title="Past state" dateLabel="mentioned" n={rel.earlier} />
              <div className="flex justify-center text-fg-4"><ArrowDown className="h-4 w-4" /></div>
              <ClaimBox title="Current state" n={rel.later} />
            </>
          ) : (
            <>
              <ClaimBox title="Earlier" n={rel.earlier} />
              <div className="flex justify-center text-fg-4"><ArrowDown className="h-4 w-4" /></div>
              <ClaimBox title={rel.relation === "contradiction" ? "Later" : "Later (current)"} n={rel.later} />
            </>
          )}
        </div>
        <div className="rounded-lg border border-line bg-bg-sunk p-3 text-[13px]">
          <p className="text-[12px] font-medium text-fg-3">Why {rel.decided_by === "reviewer" ? `${rel.decided_by_name ?? "the reviewer"} decided this` : "Baton decided this"}</p>
          <p className="mt-1 text-fg">{rel.decided_by === "reviewer" ? (rel.note || "Set by the reviewer.") : rel.signal}</p>
          {rel.decided_by === "reviewer" && rel.signal && <p className="mt-2 text-[12px] text-fg-3">Baton&apos;s rule had said: {rel.signal}</p>}
          {rel.decided_by === "rule" && <p className="mt-2 text-[12px] text-fg-3">Decided by fixed rules, not by the AI.</p>}
        </div>
        {rel.relation === "contradiction" && rel.resolution && (
          <p className="text-[13px] text-fg-2">Resolved in Verify by {rel.resolution.by ?? "the reviewer"}: {rel.resolution.kept_as_risk ? "both kept as an open risk." : `kept “${short(rel.resolution.winner === rel.earlier.id ? rel.earlier.text : rel.later.text, 80)}”.`}</p>
        )}
        {rel.relation === "contradiction" && !rel.resolution && (
          <Link href={`/w/${wsId}/review?tab=conflicts&claim=${rel.later.id}`} className="inline-flex text-[13px] font-medium text-accent-ink hover:underline">Resolve in Verify →</Link>
        )}
        {canEdit ? (
          <div className="rounded-lg border border-line p-3">
            <p className="text-[13px] font-semibold text-fg">Is that right?</p>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="How these claims relate">
              {([["reversal", "Changed decision", "The later one replaces the earlier one"], ["contradiction", "Contradiction", "They disagree: decide in Verify"],
                ["unrelated", "Unrelated", "Grouped by mistake"]] as const).map(([k, label, help]) => (
                <button key={k} role="radio" aria-checked={choice === k} onClick={() => setChoice(k)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${choice === k ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:bg-hover"}`}>
                  <span className="block text-[13px] font-medium text-fg">{label}</span>
                  <span className="block text-[11.5px] text-fg-3">{help}</span>
                </button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why? (shown in the activity log)"
              className="mt-2 h-8 w-full rounded-md border border-line-2 bg-bg px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:ring-2 focus:ring-[var(--ring)]" />
            <div className="mt-2 flex justify-end">
              <Button size="sm" loading={busy} onClick={() => void save()} data-testid="save-relation">Save</Button>
            </div>
          </div>
        ) : <p className="text-[12px] text-fg-3">Only the reviewer can change how these claims relate.</p>}
        <p className="text-[12px] text-fg-3">A reviewer&apos;s choice is kept when the pipeline runs again.</p>
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
      <DrawerHead title={staleTag(node.stale_reason)} onClose={onClose} />
      <div className="space-y-4 p-5">
        <ClaimBox title="Open work" n={node} />
        <div className="rounded-lg border border-line bg-bg-sunk p-3 text-[13px]">
          <p className="text-[12px] font-medium text-fg-3">Why Baton thinks so</p>
          <p className="mt-1 text-fg">{node.stale_reason}</p>
          <p className="mt-2 text-[12px] text-fg-3">The successor sees this as history instead of a next step. Decided by fixed rules, not by the AI.</p>
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

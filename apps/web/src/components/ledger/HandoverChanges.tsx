"use client";

import { ChevronDown, GitCompareArrows, Minus, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/ledger/StatusChip";
import { Card } from "@/components/ui";
import type { Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Item = { claim_id: string; text: string; status: Status; type_label: string; section: string; was_text?: string | null; was_status?: Status | null };
type Changes = { version: number | null; previous: number | null; added: Item[]; removed: Item[]; changed: Item[] };

/** "What changed since the last version": computed on the server after this viewer's permission projection. */
export function HandoverChanges({ handoverId, version }: { handoverId: string; version: number }) {
  const ch = useApi<Changes>(version > 1 ? `/handovers/${handoverId}/changes?version=${version}` : null);
  const [open, setOpen] = useState(false);
  const d = ch.data;
  if (!d || d.previous === null) return null;
  const total = d.added.length + d.removed.length + d.changed.length;

  return (
    <Card className="no-print mt-5 overflow-hidden" data-testid="handover-changes">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-paper/50">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-soft text-amber-ink"><GitCompareArrows className="h-4 w-4" /></span>
        <span className="flex-1">
          <span className="block font-semibold text-ink">What changed since version {d.previous}</span>
          <span className="block text-xs text-muted">
            {total === 0 ? "Nothing you can see changed." : (
              <>{d.added.length} added · {d.changed.length} updated · {d.removed.length} removed</>
            )}
          </span>
        </span>
        {total > 0 && <ChevronDown className={`h-4 w-4 text-muted transition ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && total > 0 && (
        <div className="animate-fade space-y-4 border-t border-line px-5 py-4">
          <Group title="Added" icon={<Plus className="h-3.5 w-3.5" />} tone="text-verified" items={d.added} />
          <Group title="Updated" icon={<Pencil className="h-3.5 w-3.5" />} tone="text-amber-ink" items={d.changed} />
          <Group title="No longer in the handover" icon={<Minus className="h-3.5 w-3.5" />} tone="text-missing" items={d.removed} struck />
        </div>
      )}
    </Card>
  );
}

function Group({ title, icon, tone, items, struck }: { title: string; icon: React.ReactNode; tone: string; items: Item[]; struck?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${tone}`}>{icon} {title} ({items.length})</p>
      <ul className="mt-2 space-y-2">
        {items.map((it) => (
          <li key={it.claim_id} className="rounded-xl border border-line bg-paper/40 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={it.status} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{it.type_label} · {it.section}</span>
              {it.was_status && <span className="text-[11px] text-muted">was {it.was_status}</span>}
            </div>
            <p className={`mt-1 text-sm text-ink ${struck ? "line-through decoration-line-2" : ""}`}>{it.text}</p>
            {it.was_text && <p className="mt-1 text-xs text-muted">Before: <span className="line-through">{it.was_text}</span></p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

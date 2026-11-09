"use client";

import { Check, Download, MessageSquare, Pencil, ShieldCheck, Sparkles, Undo2, X } from "lucide-react";
import { useState } from "react";

import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, Card, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/useApi";

type Entry = {
  at: string; kind: "review" | "approval"; action: string; label: string; actor: string; role: string;
  claim_id: string | null; claim: string; claim_type: string | null; note: string | null; before: string | null;
};

const ICONS: Record<string, React.ReactNode> = {
  confirm: <Check className="h-3.5 w-3.5" />, bulk_confirm: <Check className="h-3.5 w-3.5" />,
  reject: <X className="h-3.5 w-3.5" />, bulk_reject: <X className="h-3.5 w-3.5" />,
  edit: <Pencil className="h-3.5 w-3.5" />, comment: <MessageSquare className="h-3.5 w-3.5" />,
  promote: <Sparkles className="h-3.5 w-3.5" />, restore: <Undo2 className="h-3.5 w-3.5" />,
  approve: <ShieldCheck className="h-3.5 w-3.5" />,
};
const TONE: Record<string, string> = {
  confirm: "bg-verified-soft text-verified", bulk_confirm: "bg-verified-soft text-verified", approve: "bg-verified-soft text-verified",
  reject: "bg-missing-soft text-missing", bulk_reject: "bg-missing-soft text-missing",
  edit: "bg-amber-soft text-amber-ink", promote: "bg-amber-soft text-amber-ink",
};
const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "decisions", label: "Decisions", match: (e: Entry) => e.kind === "approval" || !["comment"].includes(e.action) },
  { key: "comments", label: "Comments", match: (e: Entry) => e.action === "comment" },
  { key: "approvals", label: "Approvals", match: (e: Entry) => e.kind === "approval" },
] as const;

export default function ActivityPage() {
  const { ws } = useWorkspace();
  const allowed = ws.persona.roles.some((r) => r === "admin" || r === "reviewer");
  const data = useApi<{ entries: Entry[] }>(allowed ? `/workspaces/${ws.id}/activity` : null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  if (!allowed) return <NotForPersona step="The activity log" />;
  const f = FILTERS.find((x) => x.key === filter)!;
  const entries = (data.data?.entries ?? []).filter((e) => !("match" in f) || f.match(e));

  async function exportCsv() {
    const r = await fetch(`/api/workspaces/${ws.id}/activity.csv`, { headers: { "X-Baton-Persona": ws.persona.id } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `baton-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div>
      <PageHeader eyebrow="Accountability" title="Activity log"
        description="Every review decision, comment, conflict resolution and approval, with who made it and when. Nothing here is ever edited or deleted."
        actions={<Button variant="secondary" onClick={() => void exportCsv()}><Download className="h-4 w-4" /> Export CSV</Button>} />
      <div className="mt-5 flex flex-wrap gap-1.5" role="tablist">
        {FILTERS.map((x) => (
          <button key={x.key} role="tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${filter === x.key ? "bg-strong text-on-strong ring-strong" : "bg-card text-ink-2 ring-line hover:ring-ink/25"}`}>
            {x.label}
          </button>
        ))}
      </div>
      {data.error && <Alert tone="error" className="mt-4">{data.error}</Alert>}
      {data.loading && <div className="mt-5"><SkeletonList rows={5} /></div>}
      {data.data && entries.length === 0 && (
        <div className="mt-5"><EmptyState title="No activity yet">Review decisions and approvals will appear here as they happen.</EmptyState></div>
      )}
      {entries.length > 0 && (
        <Card className="mt-5 p-0">
          <ol className="divide-y divide-line" data-testid="activity-list">
            {entries.map((e, i) => (
              <li key={i} className="flex gap-3 px-4 py-3.5">
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${TONE[e.action] ?? "bg-paper-2 text-ink-2"}`}>{ICONS[e.action] ?? <Pencil className="h-3.5 w-3.5" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink"><b>{e.actor}</b> <span className="text-muted">({e.role})</span> · {e.label}</p>
                  <p className="mt-0.5 text-sm text-ink-2">{e.claim}</p>
                  {e.before && <p className="mt-0.5 text-xs text-muted">Before: <span className="line-through">{e.before}</span></p>}
                  {e.note && <p className="mt-1 rounded-lg bg-paper px-2.5 py-1.5 text-xs text-ink-2">“{e.note}”</p>}
                </div>
                <time className="shrink-0 text-xs text-muted" dateTime={e.at} title={new Date(e.at).toLocaleString()}>{new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

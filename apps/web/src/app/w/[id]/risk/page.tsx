"use client";

import { ArrowRight, FileCode2, HelpCircle, KeyRound, ListTodo, PenLine, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { Avatar, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type ClaimRef = { id: string; text: string; type: string; status: string; refs: string[] };
type Person = {
  key: string; name: string; member_id: string | null; in_workspace: boolean; score: number; level: "high" | "medium" | "low";
  breakdown: { sole_files: number; open_tasks: number; unanswered: number; only_source: number };
  sole_files: { path: string; commits: number; total: number }[]; open_tasks: ClaimRef[]; unanswered: ClaimRef[]; only_source: ClaimRef[];
  handover_id: string | null;
};
type Risk = { people: Person[]; unowned: ClaimRef[]; rules: { weights: Record<string, number>; high: number; medium: number; sole_share: number; sole_min_commits: number } };

const LEVEL: Record<Person["level"], { label: string; tone: string; bar: string }> = {
  high: { label: "High risk", tone: "bg-mis-soft text-mis", bar: "bg-mis" },
  medium: { label: "Medium", tone: "bg-accent-soft text-accent-ink", bar: "bg-accent" },
  low: { label: "Low", tone: "bg-bg-sunk text-fg-3", bar: "bg-line-2" },
};

export default function RiskPage() {
  const { ws } = useWorkspace();
  const allowed = ws.persona.roles.some((r) => r === "admin" || r === "reviewer");
  const risk = useApi<Risk>(allowed ? `/workspaces/${ws.id}/risk` : null);
  if (!allowed) return <NotForPersona step="Knowledge risk" />;
  const max = Math.max(1, ...(risk.data?.people.map((p) => p.score) ?? [1]));
  return (
    <div>
      <PageHeader eyebrow="Before someone leaves" title="Knowledge risk"
        description="Where knowledge would be lost if one person left, worked out by fixed rules from commit history, open work, unanswered gaps and who wrote things down. Start a handover early for anyone marked high." />
      {risk.loading && <div className="mt-6"><SkeletonList rows={3} /></div>}
      {risk.error && <Alert tone="error" className="mt-6">{risk.error}</Alert>}
      {risk.data && (
        <>
          {risk.data.unowned.length > 0 && (
            <Card className="mt-6 border-mis/25 p-5" data-testid="unowned">
              <h2 className="flex items-center gap-2 font-semibold text-fg"><KeyRound className="h-4 w-4 text-mis" /> Services and accounts with no named owner ({risk.data.unowned.length})</h2>
              <p className="mt-1 text-[13px] text-fg-3">The project depends on these, but no source says who owns them. If the only person who knows leaves, access can be lost.</p>
              <ul className="mt-3 space-y-1.5">{risk.data.unowned.map((u) => <li key={u.id} className="text-[13px] text-fg">· {u.text.replace(/^Who owns (the )?/, "").replace(/\?$/, "")}</li>)}</ul>
            </Card>
          )}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="risk-people">
            {risk.data.people.length === 0 && <EmptyState title="Nothing to assess yet">Connect a repository and run the pipeline first.</EmptyState>}
            {risk.data.people.map((p) => <PersonCard key={p.key} p={p} max={max} />)}
          </div>
          <Card className="mt-6 p-4 text-[12px] leading-relaxed text-fg-3" data-testid="risk-rules">
            <b className="text-fg">How the score works.</b> Each file one person maintains alone (at least {Math.round(risk.data.rules.sole_share * 100)}% of {risk.data.rules.sole_min_commits}+ commits) counts {risk.data.rules.weights.sole_files};
            each open task that names them {risk.data.rules.weights.open_tasks}; each unanswered gap that points at them {risk.data.rules.weights.unanswered};
            each supported fact only they wrote down {risk.data.rules.weights.only_source}. {risk.data.rules.high}+ is high, {risk.data.rules.medium}+ is medium.
            No AI is involved, and only sources you can read are counted.
          </Card>
        </>
      )}
    </div>
  );
}

function PersonCard({ p, max }: { p: Person; max: number }) {
  const { ws } = useWorkspace();
  const member = ws.members.find((m) => m.id === p.member_id);
  const lv = LEVEL[p.level];
  const rows: { icon: React.ReactNode; label: string; items: string[] }[] = [
    { icon: <FileCode2 className="h-3.5 w-3.5" />, label: "Maintains alone", items: p.sole_files.map((f) => `${f.path} (${f.commits} of ${f.total} commits)`) },
    { icon: <ListTodo className="h-3.5 w-3.5" />, label: "Open tasks", items: p.open_tasks.map((c) => c.text) },
    { icon: <HelpCircle className="h-3.5 w-3.5" />, label: "Unanswered gaps", items: p.unanswered.map((c) => c.text) },
    { icon: <PenLine className="h-3.5 w-3.5" />, label: "Only they wrote it down", items: p.only_source.map((c) => c.text) },
  ];
  return (
    <Card className="p-5" data-testid={`risk-${p.key}`}>
      <div className="flex flex-wrap items-center gap-3">
        {member ? <Avatar m={member} size={34} /> : <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-bg-sunk text-fg-3"><UserX className="h-4 w-4" /></span>}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">{p.name}</p>
          {!p.in_workspace && <p className="text-[12px] text-fg-3">Contributor, not a member of this workspace</p>}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${lv.tone}`} data-testid="risk-level">{lv.label} · {p.score}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-sunk"><div className={`h-full ${lv.bar}`} style={{ width: `${Math.round((p.score / max) * 100)}%` }} /></div>
      <dl className="mt-4 space-y-3">
        {rows.filter((r) => r.items.length).map((r) => (
          <div key={r.label}>
            <dt className="flex items-center gap-1.5 text-[12px] font-medium text-fg-3">{r.icon} {r.label} · {r.items.length}</dt>
            <dd>
              <ul className="mt-1 space-y-1">
                {r.items.slice(0, 4).map((t, i) => <li key={i} className="text-[13px] leading-snug text-fg-2">{t}</li>)}
                {r.items.length > 4 && <li className="text-[12px] text-fg-3">and {r.items.length - 4} more</li>}
              </ul>
            </dd>
          </div>
        ))}
        {p.score === 0 && <p className="text-[13px] text-fg-3">Nothing depends on this person alone.</p>}
      </dl>
      {p.in_workspace && p.score > 0 && <HandoverAction p={p} />}
    </Card>
  );
}

function HandoverAction({ p }: { p: Person }) {
  const { ws } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [successor, setSuccessor] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  if (p.handover_id) {
    return (
      <div className="mt-4">
        <ButtonLink size="sm" variant="secondary" href={`/w/${ws.id}/review/preview?h=${p.handover_id}`}>Open {p.name}&apos;s handover <ArrowRight className="h-4 w-4" /></ButtonLink>
      </div>
    );
  }
  if (!isReviewer || ws.read_only) return null;
  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ handover: { id: string } }>(`/workspaces/${ws.id}/handovers`, {
        workspaceId: ws.id, method: "POST", body: { leaver_member_id: p.member_id, successor_member_id: successor, name: null, scope: null },
      });
      toast(`Handover for ${p.name} started`);
      router.push(`/w/${ws.id}/review/preview?h=${r.handover.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <div className="mt-4">
      {!open ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="risk-start">Start a handover for {p.name}</Button> : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-fg-3">Who takes over?
            <select value={successor} onChange={(e) => setSuccessor(e.target.value)} className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-fg" data-testid="risk-successor">
              <option value="">Choose a person</option>
              {ws.members.filter((m) => m.id !== p.member_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <Button size="sm" disabled={!successor} loading={busy} onClick={() => void start()}>Start handover</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          {err && <Alert tone="error" className="w-full">{err}</Alert>}
        </div>
      )}
    </div>
  );
}

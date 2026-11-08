"use client";

import { ArrowRight, FileText, GitBranch, Hash, Lock, Mic, ShieldCheck, Users } from "lucide-react";

import { CoachBar } from "@/components/CoachBar";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, ButtonLink, Card, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import type { SourceInfo } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const TYPE_META: Record<SourceInfo["type"], { label: string; Icon: typeof GitBranch }> = {
  fixture: { label: "GitHub repository", Icon: GitBranch },
  github_repo: { label: "GitHub repository", Icon: GitBranch },
  upload: { label: "Uploaded notes", Icon: FileText },
  chat_export: { label: "Chat channel", Icon: Hash },
  testimony: { label: "Leaver testimony", Icon: Mic },
};

const SCRUB_LABELS: Record<string, string> = {
  google_api_key: "Google/Firebase API key", stripe_key: "Stripe key", github_token: "GitHub token", aws_access_key: "AWS key",
  slack_token: "Slack token", jwt: "JWT", private_key: "private key", generic_secret: "password/secret",
};

function SourceCard({ s }: { s: SourceInfo }) {
  const { label, Icon } = TYPE_META[s.type];
  return (
    <Card className="lift flex flex-col p-5" data-testid="source-card">
      <div className="flex items-start gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-paper-2 text-ink ring-1 ring-line"><Icon className="h-5 w-5" strokeWidth={1.8} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
          <h3 className="truncate text-[17px] font-semibold text-ink" title={s.name}>{s.name}</h3>
        </div>
      </div>

      <div className="mt-4">
        <span data-testid="access-chip" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
          s.restricted ? "bg-missing-soft text-missing ring-missing/25" : "bg-verified-soft text-verified ring-verified/25"}`}>
          {s.restricted ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />} Visible to: {s.access}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {s.items.slice(0, 6).map((it) => (
          <div key={it.kind} className="rounded-lg bg-paper px-2.5 py-2">
            <dt className="text-[11px] text-muted">{it.label}</dt>
            <dd className="font-display text-lg font-semibold text-ink">{it.count}</dd>
          </div>
        ))}
      </dl>
      {s.files && s.files.length > 0 && <p className="mt-3 truncate text-xs text-muted" title={s.files.join(", ")}>Files: {s.files.join(", ")}</p>}

      <div className="mt-auto pt-4">
        {s.redactions > 0 ? (
          <p className="flex items-start gap-2 rounded-xl bg-supported-soft px-3 py-2 text-xs text-supported" data-testid="scrub-report">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
            <span><b>{s.redactions} secret{s.redactions > 1 ? "s" : ""} removed</b> before storage ({Object.entries(s.scrub_report).map(([k, n]) => `${n} ${SCRUB_LABELS[k] ?? k}`).join(", ")})</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 px-1 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" /> Scanned for secrets: none found</p>
        )}
      </div>
    </Card>
  );
}

export default function SourcesPage() {
  const { ws } = useWorkspace();
  const { data, error, loading } = useApi<{ sources: SourceInfo[] }>(`/workspaces/${ws.id}/sources`);
  const sources = data?.sources;
  const total = sources?.reduce((n, s) => n + s.redactions, 0) ?? 0;
  const isReviewer = ws.persona.roles.includes("reviewer");
  const canLedger = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));

  return (
    <div>
      <CoachBar id="connect" step="Step 1 · Connect.">
        These are the project sources Baton may read. Each one is tagged with who can see it, and secrets are removed before anything is
        stored. Switch persona at the top right to see how access changes.
      </CoachBar>

      <PageHeader eyebrow="Connect" title="Connected sources"
        description={isReviewer ? "As the reviewer, you can see every source in this workspace." : `Only the sources ${ws.persona.name} is allowed to read are listed.`}
        actions={total > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-strong px-3 py-1.5 text-xs font-semibold text-on-strong"><ShieldCheck className="h-3.5 w-3.5" /> {total} secrets removed in total</span> : undefined} />

      <div className="mt-7">
        {error && <Alert tone="error">Couldn&apos;t load sources: {error}</Alert>}
        {loading && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><SkeletonList rows={2} /><SkeletonList rows={2} /></div>}
        {sources && sources.length === 0 && (
          <EmptyState icon={<GitBranch className="h-5 w-5" />} title="No sources yet">Connect a GitHub repository, upload notes or import a chat export to begin.</EmptyState>
        )}
        {sources && sources.length > 0 && (
          <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">{sources.map((s) => <SourceCard key={s.id} s={s} />)}</div>
        )}
      </div>

      <Card className="mt-8 flex flex-col items-start justify-between gap-4 bg-strong p-6 text-on-strong sm:flex-row sm:items-center">
        <div>
          <p className="font-display text-lg font-semibold">What happens next</p>
          <p className="mt-1 max-w-2xl text-sm text-on-strong/75">
            Baton reconstructs a ledger of claims (decisions, owners, open work, risks), each tied to a quoted source. Restricted sources are
            processed separately, so their content never mixes into claims others can see.
          </p>
        </div>
        <ButtonLink href={canLedger ? `/w/${ws.id}/ledger` : `/w/${ws.id}/handover`} variant="amber">
          {canLedger ? "See the ledger" : "Open my handover"} <ArrowRight className="h-4 w-4" />
        </ButtonLink>
      </Card>
    </div>
  );
}

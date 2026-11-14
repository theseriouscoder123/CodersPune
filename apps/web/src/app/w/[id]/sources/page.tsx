"use client";

import { ArrowRight, Code2, Download, FileText, GitBranch, Hash, Lock, Mic, MoreHorizontal, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AccessEditor } from "@/components/workspace/AccessEditor";
import { SlackImport } from "@/components/workspace/SlackImport";
import { Avatar, TopbarActions, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, ButtonLink, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import type { SourceInfo } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const TYPE_META: Record<SourceInfo["type"], { label: string; Icon: typeof GitBranch }> = {
  fixture: { label: "GitHub repository", Icon: Code2 },
  github_repo: { label: "GitHub repository", Icon: Code2 },
  upload: { label: "Uploaded notes", Icon: FileText },
  chat_export: { label: "Chat channel", Icon: Hash },
  testimony: { label: "Leaver testimony", Icon: Mic },
};

const SCRUB_LABELS: Record<string, string> = {
  google_api_key: "Google/Firebase API key", stripe_key: "Stripe key", github_token: "GitHub token", aws_access_key: "AWS key",
  slack_token: "Slack token", jwt: "JWT", private_key: "private key", generic_secret: "password or secret",
};

function SourceRow({ s, canEdit, workspaceId, onSaved }: { s: SourceInfo; canEdit: boolean; workspaceId: string; onSaved: () => void }) {
  const { ws } = useWorkspace();
  const { label, Icon } = TYPE_META[s.type];
  const [editing, setEditing] = useState(false);
  const people = s.restricted ? ws.members.filter((m) => s.access.includes(m.name)) : [];
  const contents = s.items.slice(0, 4).map((it) => `${it.count} ${it.label.toLowerCase()}`).join(" · ");
  return (
    <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-3.5 py-3 text-[13px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_110px_28px]" data-testid="source-card">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-fg-2"><Icon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-[12.5px] text-fg" title={s.name}>{s.name}</span>
          <span className="block text-[12px] text-fg-3">{label}{s.files && s.files.length > 0 ? ` · ${s.files.length} file${s.files.length === 1 ? "" : "s"}` : ""}</span>
        </span>
      </div>
      <span className="min-w-0 truncate text-fg-2" title={s.files?.join(", ")}>{contents || `${s.chunk_count} passages`}</span>
      <span className="flex min-w-0 items-center gap-2" data-testid="access-chip">
        {s.restricted ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-con-soft px-2 text-[12px] font-medium leading-5 text-con" title={`Visible to: ${s.access}`}>
              <Lock className="h-3 w-3" /> {people.length ? `${people.length} people` : "Restricted"}
            </span>
            <span className="flex -space-x-[5px]">{people.slice(0, 4).map((m) => <Avatar key={m.id} m={m} size={18} />)}</span>
            <span className="sr-only">Visible to: {s.access}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-fg-2"><Users className="h-3.5 w-3.5 text-fg-3" /> {s.access}</span>
        )}
      </span>
      <span className={`text-[12.5px] ${s.redactions ? "text-ver" : "text-fg-3"}`} data-testid={s.redactions ? "scrub-report" : undefined}
        title={s.redactions ? Object.entries(s.scrub_report).map(([k, n]) => `${n} ${SCRUB_LABELS[k] ?? k}`).join(", ") : undefined}>
        {s.redactions ? `${s.redactions} removed` : "None found"}
      </span>
      <span className="flex justify-end">
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} data-testid="change-access" aria-label={`Change who can access ${s.name}`} title="Change access"
            className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg"><MoreHorizontal className="h-4 w-4" /></button>
        )}
      </span>
      {canEdit && editing && <AccessEditor workspaceId={workspaceId} sourceId={s.id} open={editing} onClose={() => setEditing(false)} onSaved={onSaved} />}
    </div>
  );
}

export default function SourcesPage() {
  const { ws } = useWorkspace();
  const { data, error, loading, reload } = useApi<{ sources: SourceInfo[] }>(`/workspaces/${ws.id}/sources`);
  const canEdit = ws.persona.roles.includes("admin") && !ws.read_only;
  const sources = data?.sources;
  const total = sources?.reduce((n, s) => n + s.redactions, 0) ?? 0;
  const isReviewer = ws.persona.roles.includes("reviewer");
  const canLedger = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));
  const scrubbed = (sources ?? []).flatMap((s) => Object.entries(s.scrub_report ?? {}).map(([k, n]) => `${n} ${SCRUB_LABELS[k] ?? k} in ${s.name}`));

  return (
    <div>
      <TopbarActions>
        {canEdit && <SlackImport wsId={ws.id} synthetic={!!ws.synthetic} onImported={reload} />}
      </TopbarActions>

      <PageHeader title="Connected sources"
        description={isReviewer
          ? "Everything Baton may read for this handover, and who can see each one. A claim is only shown to someone who can see every source it cites. Switch person at the bottom left (in the menu on a phone) to see the difference."
          : `Only the sources ${ws.persona.name} is allowed to read are listed. A claim is only shown to someone who can see every source it cites.`} />

      {total > 0 && (
        <div className="mt-6"><Alert tone="success">
          <span><b className="font-semibold">{total} secret{total === 1 ? "" : "s"} removed</b> before anything was stored or sent to the AI.</span>
          <span className="mt-0.5 block text-[12.5px] text-fg-3">{scrubbed.join(" · ")}. Personal emails and phone numbers are masked for everyone except the reviewer.</span>
        </Alert></div>
      )}

      <div className="mt-6">
        {error && <Alert tone="error">Couldn&apos;t load sources: {error}</Alert>}
        {loading && <SkeletonList rows={4} />}
        {sources && sources.length === 0 && (
          <EmptyState icon={<GitBranch />} title="No sources yet">Connect a GitHub repository, upload notes or import a chat export to begin.</EmptyState>
        )}
        {sources && sources.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_110px_28px] gap-x-4 border-b border-line bg-bg-sunk px-3.5 py-2 text-[12px] font-medium text-fg-3 md:grid">
              <span>Source</span><span>Contents</span><span>Visible to</span><span>Secrets</span><span />
            </div>
            <div className="divide-y divide-line">
              {sources.map((s) => <SourceRow key={s.id} s={s} canEdit={canEdit} workspaceId={ws.id} onSaved={reload} />)}
            </div>
          </div>
        )}
      </div>

      {canEdit && (
        <section className="mt-10">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg">Add a source</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Each source gets its own access list. Secrets are removed before anything is stored.</p>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { Icon: Code2, title: "GitHub repository", body: "Public or private. Commits, PRs, issues and key files. A private token is used once and never stored." },
              { Icon: FileText, title: "Notes and documents", body: "Markdown, text, PDF or Word. Meeting notes, runbooks, design docs." },
              { Icon: Download, title: "Chat export", body: "A Slack or Discord export. Each channel becomes its own source with its own access." },
            ].map((t) => (
              <Link key={t.title} href="/new" className="flex flex-col rounded-lg border border-line p-3.5 transition-colors hover:bg-hover">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-fg"><t.Icon className="h-3.5 w-3.5" /> {t.title}</span>
                <span className="mt-1 text-[12.5px] leading-[18px] text-fg-3">{t.body}</span>
              </Link>
            ))}
            <SlackImport wsId={ws.id} synthetic={!!ws.synthetic} onImported={reload} tile />
          </div>
        </section>
      )}

      {!canLedger && !ws.persona.roles.includes("successor") ? (
        <div className="mt-10 rounded-lg border border-line px-4 py-3 text-[13px]">
          <p className="font-semibold text-fg">{ws.persona.name} has no part in this handover</p>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Members see only the sources they can read. Switch person at the bottom left (in the menu on a phone) to follow the handover as the reviewer or the successor.</p>
        </div>
      ) : (
      <div className="mt-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-accent-soft px-4 py-3">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-fg">Next: {canLedger ? "Reconstruct" : "your handover"}</p>
          <p className="text-[12.5px] text-fg-3">{canLedger ? "Baton turned these sources into claims, each linked to a quote. Restricted sources are read in their own batches, so their text never mixes into claims others can see." : "The approved handover shows only what you are allowed to see."}</p>
        </div>
        <ButtonLink size="sm" href={canLedger ? `/w/${ws.id}/ledger` : `/w/${ws.id}/handover`}>{canLedger ? "See the ledger" : "Open my handover"} <ArrowRight /></ButtonLink>
      </div>
      )}
    </div>
  );
}

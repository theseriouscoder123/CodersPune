"use client";

import { useEffect, useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api, type SourceInfo } from "@/lib/api";

const TYPE_META: Record<SourceInfo["type"], { label: string; icon: string }> = {
  fixture: { label: "GitHub repository", icon: "⌥" },
  github_repo: { label: "GitHub repository", icon: "⌥" },
  upload: { label: "Uploaded notes", icon: "📄" },
  chat_export: { label: "Chat channel export", icon: "#" },
  testimony: { label: "Leaver testimony", icon: "🎙" },
};

const SCRUB_LABELS: Record<string, string> = {
  google_api_key: "Google/Firebase API key",
  stripe_key: "Stripe key",
  github_token: "GitHub token",
  aws_access_key: "AWS access key",
  slack_token: "Slack token",
  jwt: "JWT",
  private_key: "private key",
  generic_secret: "password/secret",
};

function SourceCard({ s }: { s: SourceInfo }) {
  const meta = TYPE_META[s.type];
  return (
    <article className="flex flex-col rounded-xl border border-line bg-white p-5" data-testid="source-card">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-panel font-mono text-lg text-navy" aria-hidden>
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{meta.label}</p>
          <h3 className="truncate text-base font-semibold text-navy" title={s.name}>{s.name}</h3>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${
            s.restricted ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"
          }`}
          data-testid="access-chip"
        >
          {s.restricted ? "🔒 " : ""}Visible to: {s.access}
        </span>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {s.items.map((it) => (
          <li key={it.kind}>
            <span className="font-semibold text-navy">{it.count}</span> {it.label}
          </li>
        ))}
      </ul>
      {s.files && s.files.length > 0 && <p className="mt-2 text-xs text-muted">Files: {s.files.join(", ")}</p>}

      <div className="mt-auto pt-4">
        {s.redactions > 0 ? (
          <p className="rounded-lg bg-panel px-3 py-2 text-xs text-navy" data-testid="scrub-report">
            🛡 {s.redactions} secret{s.redactions > 1 ? "s" : ""} removed before storage (
            {Object.entries(s.scrub_report).map(([k, n]) => `${n} ${SCRUB_LABELS[k] ?? k}`).join(", ")})
          </p>
        ) : (
          <p className="px-1 text-xs text-muted">🛡 Scanned for secrets: none found</p>
        )}
      </div>
    </article>
  );
}

export default function SourcesPage() {
  const { ws, personaVersion } = useWorkspace();
  // Results are tagged with the persona they were fetched for, so switching persona never shows stale data.
  const loadKey = `${ws.id}:${ws.persona.id}:${personaVersion}`;
  const [result, setResult] = useState<{ key: string; sources?: SourceInfo[]; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ sources: SourceInfo[] }>(`/workspaces/${ws.id}/sources`, { workspaceId: ws.id })
      .then((r) => !cancelled && setResult({ key: loadKey, sources: r.sources }))
      .catch((e) => !cancelled && setResult({ key: loadKey, error: String(e.message ?? e) }));
    return () => {
      cancelled = true;
    };
  }, [ws.id, loadKey]);

  const current = result?.key === loadKey ? result : null;
  const sources = current?.sources ?? null;
  const error = current?.error ?? null;

  const total = sources?.reduce((n, s) => n + s.redactions, 0) ?? 0;
  const isReviewer = ws.persona.roles.includes("reviewer");

  return (
    <div>
      <CoachBar id="connect">
        <b>Step 1 · Connect.</b> These are the project sources Baton is allowed to read. Each one is tagged with who may see
        it, and secrets are stripped before anything is stored. Switch persona (top right) to see how access changes.
      </CoachBar>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">Connected sources</h1>
          <p className="mt-1 text-sm text-muted">
            {isReviewer
              ? "As the reviewer, you can see every source in this workspace."
              : `Showing only the sources ${ws.persona.name} is allowed to read.`}
          </p>
        </div>
        {total > 0 && (
          <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">{total} secrets removed in total</span>
        )}
      </div>

      {error && <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">Couldn&apos;t load sources: {error}</p>}
      {!sources && !error && <p className="mt-6 text-muted">Loading sources…</p>}
      {sources && sources.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-line p-10 text-center">
          <p className="font-semibold text-navy">No sources yet</p>
          <p className="mt-1 text-sm text-muted">Connect a GitHub repository, upload notes or import a chat export to begin.</p>
        </div>
      )}
      {sources && sources.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {sources.map((s) => (
            <SourceCard key={s.id} s={s} />
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-line bg-panel p-5 text-sm">
        <p className="font-semibold text-navy">What happens next</p>
        <p className="mt-1 text-muted">
          Baton reads these sources and reconstructs a ledger of claims (decisions, owners, open work, risks), each tied to a
          quoted source. Restricted sources are processed separately, so their content never mixes into claims others can see.
          <span className="ml-1 font-medium text-navy">The ledger arrives in the next build milestone.</span>
        </p>
      </div>
    </div>
  );
}

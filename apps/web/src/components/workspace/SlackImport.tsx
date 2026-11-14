"use client";

import { ArrowRight, Hash, Lock, Slack, UserX } from "lucide-react";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Alert, Button, ButtonLink, Modal } from "@/components/ui";
import { api } from "@/lib/api";

type Channel = { id: string; name: string; private: boolean; imported: boolean };
type Imported = { source_id: string; name: string; private: boolean; messages: number; chunks: number; access: string; unmatched: string[]; secrets_removed: number };

/** Live Slack connector: the bot token is used for these two requests and never stored. */
export function SlackImport({ wsId, synthetic, onImported, tile = false }: { wsId: string; synthetic: boolean; onImported: () => void; tile?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [team, setTeam] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Imported[] | null>(null);
  const [busy, setBusy] = useState<"list" | "import" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setToken(""); setTeam(null); setChannels(null); setPicked(new Set()); setResult(null); setErr(null);
  }
  async function find() {
    setBusy("list");
    setErr(null);
    try {
      const r = await api<{ team: string; channels: Channel[] }>(`/workspaces/${wsId}/slack/channels`, { workspaceId: wsId, method: "POST", body: { token } });
      setTeam(r.team);
      setChannels(r.channels);
      setPicked(new Set(r.channels.filter((c) => !c.imported).map((c) => c.id)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function run() {
    setBusy("import");
    setErr(null);
    try {
      const r = await api<{ imported: Imported[] }>(`/workspaces/${wsId}/slack/import`, { workspaceId: wsId, method: "POST", body: { token, channel_ids: [...picked] } });
      setResult(r.imported);
      setToken(""); // the token isn't kept, not even in the page
      toast(`Imported ${r.imported.length} channel${r.imported.length === 1 ? "" : "s"} from Slack`);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {tile ? (
        <button type="button" onClick={() => { reset(); setOpen(true); }} className="flex h-full w-full flex-col rounded-lg border border-line p-3.5 text-left transition-colors hover:bg-hover">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-fg"><Hash className="h-3.5 w-3.5" /> Slack, live</span>
          <span className="mt-1 text-[12.5px] leading-[18px] text-fg-3">Pick channels with a bot token, used once. Channel membership becomes the access list.</span>
        </button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => { reset(); setOpen(true); }} data-testid="slack-import-open"><Slack /> Import from Slack</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} label="Import from Slack">
        <h2 className="font-display flex items-center gap-2 text-xl font-semibold text-ink"><Slack className="h-5 w-5" /> Import from Slack</h2>
        {synthetic ? (
          <div className="mt-3 space-y-3 text-sm text-ink-2">
            <p>This demo uses synthetic data, so it doesn&apos;t connect to a real Slack. In your own workspace you can read channels directly:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Baton reads only channels its Slack app has been invited to.</li>
              <li>A private channel stays private: only its Slack members (matched by email or name) can see what Baton learns from it.</li>
              <li>The token is used once and never stored. Secrets are removed before anything is saved.</li>
            </ul>
            <div className="flex justify-end"><ButtonLink href="/new">Start from your own project <ArrowRight className="h-4 w-4" /></ButtonLink></div>
          </div>
        ) : result ? (
          <div className="mt-3" data-testid="slack-import-result">
            <ul className="space-y-2">
              {result.map((r) => (
                <li key={r.source_id} className="rounded-xl border border-line p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold text-ink">{r.private ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />} {r.name.replace(/^#/, "")}</p>
                  <p className="mt-0.5 text-xs text-muted">{r.messages} messages · {r.chunks} passages · visible to {r.access}{r.secrets_removed ? ` · ${r.secrets_removed} secret${r.secrets_removed === 1 ? "" : "s"} removed` : ""}</p>
                  {r.unmatched.length > 0 && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-ink"><UserX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Not in this workspace, so they can&apos;t see it here: {r.unmatched.slice(0, 6).join(", ")}{r.unmatched.length > 6 ? ` and ${r.unmatched.length - 6} more` : ""}. Add them on the Team page.</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">Next, re-run the pipeline so Baton extracts claims from the new messages.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
              <ButtonLink href={`/w/${wsId}/ledger`}>Go to Reconstruct <ArrowRight className="h-4 w-4" /></ButtonLink>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">Paste your Slack app&apos;s <b>Bot User OAuth Token</b> (starts with <code className="font-mono">xoxb-</code>). Baton reads only channels the app has been invited to. The token is used for this import and never stored.</p>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (token.trim()) void find(); }}>
              <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="xoxb-…" aria-label="Slack bot token"
                className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 font-mono text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" data-testid="slack-token" />
              <Button type="submit" variant="secondary" loading={busy === "list"} disabled={!token.trim()}>Find channels</Button>
            </form>
            {channels && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{team} · channels the app can read</p>
                {channels.length === 0 && <p className="mt-2 text-sm text-muted">None yet. In Slack, type <code className="font-mono">/invite @YourApp</code> in each channel you want Baton to read.</p>}
                <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
                  {channels.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-paper-2">
                        <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                        {c.private ? <Lock className="h-3.5 w-3.5 text-muted" /> : <Hash className="h-3.5 w-3.5 text-muted" />}
                        <span className="text-ink">{c.name}</span>
                        {c.private && <span className="text-xs text-muted">private: only its members will see it</span>}
                        {c.imported && <span className="ml-auto text-xs text-muted">imported (re-import updates it)</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {err && <Alert tone="error">{err}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              {channels && channels.length > 0 && <Button loading={busy === "import"} disabled={picked.size === 0} onClick={() => void run()} data-testid="slack-import-run">Import {picked.size} channel{picked.size === 1 ? "" : "s"}</Button>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

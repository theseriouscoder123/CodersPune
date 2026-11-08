"use client";

import { Copy, Link2, Lock, RefreshCw, ShieldCheck, Unlock, UserX } from "lucide-react";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { Avatar, RoleBadge, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, Card, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Team = {
  identity_mode: "switcher" | "invites";
  can_manage: boolean;
  members: { id: string; name: string; handle: string; roles: string[]; has_invite: boolean; joined: number; is_you: boolean }[];
};

export default function TeamPage() {
  const { ws } = useWorkspace();
  const toast = useToast();
  const allowed = ws.persona.roles.some((r) => r === "admin" || r === "reviewer");
  const team = useApi<Team>(allowed ? `/workspaces/${ws.id}/team` : null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!allowed) return <NotForPersona step="Team settings" />;
  const t = team.data;

  async function invite(memberId: string) {
    setBusy(memberId);
    try {
      const r = await api<{ path: string; member: string }>(`/workspaces/${ws.id}/invites/${memberId}`, { workspaceId: ws.id, method: "POST" });
      const url = `${window.location.origin}${r.path}`;
      setLinks((l) => ({ ...l, [memberId]: url }));
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast(`Private link for ${r.member} copied. Any older link for them stops working.`);
      team.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(memberId: string, name: string) {
    if (!confirm(`Revoke ${name}'s link? Anyone who joined as ${name} loses access.`)) return;
    setBusy(memberId);
    try {
      await api(`/workspaces/${ws.id}/invites/${memberId}`, { workspaceId: ws.id, method: "DELETE" });
      setLinks((l) => ({ ...l, [memberId]: "" }));
      toast(`${name}'s link revoked`);
      team.reload();
    } finally {
      setBusy(null);
    }
  }

  async function setMode(mode: "switcher" | "invites") {
    if (mode === "invites" && !confirm("Lock identities? Persona switching turns off for everyone, including you. Each person must open their own private link.")) return;
    setBusy("mode");
    try {
      await api(`/workspaces/${ws.id}/identity`, { workspaceId: ws.id, method: "PATCH", body: { mode } });
      toast(mode === "invites" ? "Identities locked. Share each person's private link." : "Persona switching is back on.");
      window.location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Team" title="People and access"
        description="Give each person their own private link. When identities are locked, the server decides who someone is from their link, so nobody can view the workspace as someone else." />
      {team.error && <Alert tone="error" className="mt-4">{team.error}</Alert>}
      {team.loading && <div className="mt-6"><SkeletonList rows={3} /></div>}
      {t && (
        <>
          <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.identity_mode === "invites" ? "bg-verified-soft text-verified" : "bg-amber-soft text-amber-ink"}`}>
                {t.identity_mode === "invites" ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
              </span>
              <div>
                <p className="font-semibold text-ink">{t.identity_mode === "invites" ? "Identities are locked" : "Persona switching is on"}</p>
                <p className="mt-0.5 max-w-xl text-sm text-muted">
                  {t.identity_mode === "invites"
                    ? "Each person sees only what their role and source access allow. Persona switching is off for everyone."
                    : "Fine for demos and trying things out: anyone with this workspace open can view it as any member. Lock identities before sharing real data."}
                </p>
              </div>
            </div>
            {t.can_manage && (
              <Button variant={t.identity_mode === "invites" ? "secondary" : "primary"} loading={busy === "mode"}
                onClick={() => setMode(t.identity_mode === "invites" ? "switcher" : "invites")} data-testid="identity-toggle">
                {t.identity_mode === "invites" ? <><Unlock className="h-4 w-4" /> Allow persona switching</> : <><ShieldCheck className="h-4 w-4" /> Lock identities</>}
              </Button>
            )}
          </Card>

          <div className="stagger mt-5 overflow-hidden rounded-2xl border border-line bg-card">
            {t.members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <Avatar m={m} size={36} />
                <div className="min-w-[160px] flex-1">
                  <p className="font-semibold text-ink">{m.name} {m.is_you && <span className="text-xs font-normal text-muted">(you)</span>}</p>
                  <div className="mt-0.5 flex flex-wrap gap-1">{m.roles.filter((r) => r !== "member" || m.roles.length === 1).map((r) => <RoleBadge key={r} role={r} />)}</div>
                </div>
                <span className="text-xs text-muted">
                  {m.has_invite ? <span className="inline-flex items-center gap-1 text-verified"><Link2 className="h-3 w-3" /> link active</span> : "no link yet"}
                  {m.joined ? ` · ${m.joined} device${m.joined > 1 ? "s" : ""} joined` : ""}
                </span>
                {t.can_manage && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" loading={busy === m.id} onClick={() => invite(m.id)}>
                      {m.has_invite ? <><RefreshCw className="h-3.5 w-3.5" /> New link</> : <><Link2 className="h-3.5 w-3.5" /> Create link</>}
                    </Button>
                    {m.has_invite && !m.is_you && <Button size="sm" variant="danger" disabled={busy === m.id} onClick={() => revoke(m.id, m.name)}><UserX className="h-3.5 w-3.5" /> Revoke</Button>}
                  </div>
                )}
                {links[m.id] && (
                  <div className="animate-fade flex w-full items-center gap-2 rounded-xl bg-paper px-3 py-2">
                    <code className="flex-1 truncate font-mono text-xs text-ink-2">{links[m.id]}</code>
                    <button className="rounded-lg p-1.5 text-muted hover:bg-paper-2 hover:text-ink" aria-label="Copy link"
                      onClick={() => { void navigator.clipboard.writeText(links[m.id]); toast("Link copied"); }}><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Links are shown once and stored only as a hash. Making a new link or revoking one immediately invalidates the old one.</p>
        </>
      )}
    </div>
  );
}

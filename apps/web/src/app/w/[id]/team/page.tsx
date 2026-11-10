"use client";

import { Bell, Copy, Download, Link2, Lock, Mail, RefreshCw, Send, ShieldCheck, Slack, Trash2, Unlock, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { Avatar, RoleBadge, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, Card, Modal, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useConfirm } from "@/components/Confirm";

type Team = {
  identity_mode: "switcher" | "invites";
  can_manage: boolean;
  members: { id: string; name: string; handle: string; roles: string[]; has_invite: boolean; joined: number; is_you: boolean; email?: string | null }[];
  notifications?: {
    email: { configured: boolean; from: string | null };
    slack: { set: boolean; hint: string };
    recent: { channel: string; event: string; recipient: string | null; status: string; detail: string | null; at: string }[];
  };
};

type SendResult = { channel: string; status: "sent" | "skipped" | "failed"; detail: string };

export default function TeamPage() {
  const { ws } = useWorkspace();
  const toast = useToast();
  const allowed = ws.persona.roles.some((r) => r === "admin" || r === "reviewer");
  const team = useApi<Team>(allowed ? `/workspaces/${ws.id}/team` : null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const confirmDialog = useConfirm();
  if (!allowed) return <NotForPersona step="Team settings" />;
  const t = team.data;

  async function invite(memberId: string, sendEmail = false) {
    setBusy(memberId);
    try {
      const r = await api<{ path: string; member: string; emailed: SendResult | null }>(
        `/workspaces/${ws.id}/invites/${memberId}${sendEmail ? "?send_email=true" : ""}`, { workspaceId: ws.id, method: "POST" });
      const url = `${window.location.origin}${r.path}`;
      setLinks((l) => ({ ...l, [memberId]: url }));
      await navigator.clipboard.writeText(url).catch(() => undefined);
      if (r.emailed?.status === "sent") toast(`Private link emailed to ${r.member} (and copied). Any older link stops working.`);
      else if (r.emailed) toast(`Link copied, but not emailed: ${r.emailed.detail}`, "error");
      else toast(`Private link for ${r.member} copied. Any older link for them stops working.`);
      team.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(memberId: string, name: string) {
    if (!(await confirmDialog({ title: `Revoke ${name}'s link?`, body: `Anyone who joined with it is signed out of this workspace immediately. You can create a new link afterwards.`,
      confirmLabel: "Revoke link", tone: "danger" }))) return;
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
    if (mode === "invites" && !(await confirmDialog({ title: "Lock identities?",
      body: "Persona switching turns off for everyone, including you. From then on each person sees the workspace only as themselves, through their own private link.",
      confirmLabel: "Lock identities" }))) return;
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
                    {m.email && t.notifications?.email.configured && !m.is_you && (
                      <Button size="sm" variant="ghost" disabled={busy === m.id} onClick={() => invite(m.id, true)} title={`Create a new link and email it to ${m.email}`}>
                        <Mail className="h-3.5 w-3.5" /> Email link
                      </Button>
                    )}
                    {m.has_invite && !m.is_you && <Button size="sm" variant="danger" disabled={busy === m.id} onClick={() => revoke(m.id, m.name)}><UserX className="h-3.5 w-3.5" /> Revoke</Button>}
                  </div>
                )}
                {t.can_manage && <MemberEmail wsId={ws.id} member={m} onSaved={team.reload} />}
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
          {t.notifications && <NotificationsCard wsId={ws.id} n={t.notifications} canManage={t.can_manage} onChanged={team.reload} />}
          <DataCard />
        </>
      )}
    </div>
  );
}

function MemberEmail({ wsId, member, onSaved }: { wsId: string; member: Team["members"][number]; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(member.email ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== (member.email ?? "");

  async function save() {
    setSaving(true);
    try {
      await api(`/workspaces/${wsId}/members/${member.id}/email`, { workspaceId: wsId, method: "PUT", body: { email: value.trim() || null } });
      toast(value.trim() ? `Saved ${member.name}'s email` : `Removed ${member.name}'s email`);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex w-full items-center gap-2 sm:w-auto sm:basis-full sm:pl-12" onSubmit={(e) => { e.preventDefault(); if (dirty) void save(); }}>
      <Mail className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      <input type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Email for notifications (optional)"
        aria-label={`Email for ${member.name}`} maxLength={254}
        className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 text-xs outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30 sm:max-w-xs" />
      {dirty && <Button size="sm" variant="secondary" type="submit" loading={saving}>Save</Button>}
    </form>
  );
}

function NotificationsCard({ wsId, n, canManage, onChanged }:
  { wsId: string; n: NonNullable<Team["notifications"]>; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [hook, setHook] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function saveHook(value: string | null) {
    setBusy("hook");
    try {
      await api(`/workspaces/${wsId}/notify`, { workspaceId: wsId, method: "PUT", body: { slack_webhook: value } });
      toast(value ? "Slack webhook saved" : "Slack webhook removed");
      setHook("");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function test(channel: "email" | "slack") {
    setBusy(channel);
    try {
      const r = await api<SendResult>(`/workspaces/${wsId}/notify/test`, { workspaceId: wsId, method: "POST", body: { channel } });
      toast(r.status === "sent" ? (channel === "email" ? "Test email sent to your address" : "Test message posted to Slack") : r.detail,
        r.status === "sent" ? "success" : "error");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mt-6 p-5" data-testid="notifications">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-supported-soft text-supported"><Bell className="h-4 w-4" /></span>
        <div>
          <p className="font-semibold text-ink">Notifications <span className="font-normal text-muted">(optional)</span></p>
          <p className="text-xs text-muted">Messages carry names and a link, never claim text, so they can&apos;t reveal anything a person isn&apos;t allowed to see.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper/50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Mail className="h-4 w-4" /> Email</p>
          {n.email.configured ? (
            <p className="mt-1 text-xs text-muted">Sending from {n.email.from}. The successor and leaver get an email when a version is approved; you can email invite links and the leaver&apos;s questions. Add addresses next to each person above.</p>
          ) : (
            <p className="mt-1 text-xs text-muted">Not configured on this server. Everything else works; to turn it on, the operator sets <code className="font-mono">SMTP_USER</code> and <code className="font-mono">SMTP_PASSWORD</code> (a Gmail app password).</p>
          )}
          {canManage && n.email.configured && (
            <Button size="sm" variant="secondary" className="mt-3" loading={busy === "email"} onClick={() => test("email")}><Send className="h-3.5 w-3.5" /> Send me a test</Button>
          )}
        </div>
        <div className="rounded-xl border border-line bg-paper/50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Slack className="h-4 w-4" /> Slack</p>
          <p className="mt-1 text-xs text-muted">
            {n.slack.set ? <>Posting to <code className="font-mono">{n.slack.hint}</code> when a run finishes and when a handover is approved.</>
              : <>Paste a Slack <a className="underline underline-offset-2" href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">incoming webhook</a> to post run results and approvals to a channel.</>}
          </p>
          {canManage && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (hook.trim()) void saveHook(hook.trim()); }}>
              <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://hooks.slack.com/services/…" aria-label="Slack webhook URL"
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 font-mono text-xs outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" />
              <Button size="sm" variant="secondary" type="submit" loading={busy === "hook"} disabled={!hook.trim()}>Save</Button>
            </form>
          )}
          {canManage && n.slack.set && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" loading={busy === "slack"} onClick={() => test("slack")}><Send className="h-3.5 w-3.5" /> Test</Button>
              <Button size="sm" variant="ghost" disabled={busy === "hook"} onClick={() => saveHook(null)}>Remove</Button>
            </div>
          )}
        </div>
      </div>

      {n.recent.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Recent</p>
          <ul className="mt-2 space-y-1 text-xs">
            {n.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-ink-2">
                <span className={`rounded-full px-1.5 py-px font-medium ${r.status === "sent" ? "bg-verified-soft text-verified" : r.status === "failed" ? "bg-missing-soft text-missing" : "bg-paper-2 text-muted"}`}>{r.status}</span>
                <span>{r.channel} · {r.event.replaceAll("_", " ")}</span>
                {r.recipient && <span className="font-mono text-muted">{r.recipient}</span>}
                {r.detail && <span className="text-muted">· {r.detail}</span>}
                <span className="ml-auto text-muted">{new Date(r.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function DataCard() {
  const { ws } = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const canDelete = !!ws.is_owner && ws.persona.roles.includes("admin") && !ws.read_only;

  async function exportJson() {
    const r = await fetch(`/api/workspaces/${ws.id}/export.json`, { headers: { "X-Baton-Persona": ws.persona.id } });
    if (!r.ok) return toast("Couldn't export this workspace", "error");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = (r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]) ?? "baton-export.json";
    a.click();
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}`, { workspaceId: ws.id, method: "DELETE", body: { confirm_name: name } });
      toast("Workspace deleted");
      router.replace("/");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-5" data-testid="data-card">
      <p className="font-semibold text-ink">Your data</p>
      <p className="mt-0.5 text-sm text-muted">Download everything in this workspace (sources, claims, evidence, reviews and approved versions) as JSON. Secrets were removed before storage, so they aren&apos;t in the export.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void exportJson()}><Download className="h-4 w-4" /> Export JSON</Button>
        {canDelete && <Button variant="danger" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" /> Delete workspace</Button>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} label="Delete workspace">
        <p className="font-display text-lg font-semibold text-ink">Delete “{ws.name}”?</p>
        <p className="mt-2 text-sm text-muted">This permanently removes its sources, claims, evidence, reviews, handovers and invite links for everyone. It can&apos;t be undone. Export first if you might need it.</p>
        <label className="mt-4 block text-xs font-medium text-ink-2" htmlFor="confirm-name">Type the workspace name to confirm</label>
        <input id="confirm-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off"
          className="mt-1 h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={name.trim() !== ws.name} onClick={() => void remove()}>Delete permanently</Button>
        </div>
      </Modal>
    </Card>
  );
}

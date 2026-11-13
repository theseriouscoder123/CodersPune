"use client";

import { AlertTriangle, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { useToast } from "@/components/Toast";
import { Alert, Button, Modal, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

type AclView = {
  source: { id: string; name: string; type: string };
  acl: { roles: string[]; members: string[] };
  access: string;
  grantable_roles: string[];
  members: { id: string; name: string }[];
  changed?: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  all_members: "Everyone in the workspace",
  reviewer: "Reviewers",
  leaver: "The leaver",
  successor: "Successors",
  member: "Members",
};

/** Admin-only: change who can read a source. The server enforces the role and audits the change. */
export function AccessEditor({ workspaceId, sourceId, open, onClose, onSaved }: {
  workspaceId: string; sourceId: string; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [view, setView] = useState<AclView | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<AclView>(`/sources/${sourceId}/acl`, { workspaceId })
      .then((v) => { setView(v); setRoles(v.acl.roles); setMembers(v.acl.members); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, sourceId, workspaceId]);

  const everyone = roles.includes("all_members");
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<AclView>(`/sources/${sourceId}/acl`, { workspaceId, method: "PATCH", body: { roles, members, note: note.trim() || null } });
      toast(r.changed ? `Access updated: ${r.access}` : "No change: access was already set this way");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} label="Change who can access this source">
      <div data-testid="access-editor">
        <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><KeyRound className="h-4 w-4 text-amber-ink" /> Who can read {view?.source.name ?? "this source"}?</p>
        <p className="mt-1 text-sm text-muted">Reviewers always see every source. A claim is shown to someone only if they can read every source it cites.</p>
        {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}
        {!view && !error && <div className="flex justify-center py-8"><Spinner className="h-5 w-5 text-muted" /></div>}
        {view && (
          <>
            <fieldset className="mt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted">By role</legend>
              <div className="mt-2 space-y-1.5">
                {view.grantable_roles.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(roles, setRoles, r)}
                      disabled={r !== "all_members" && r !== "reviewer" && everyone} className="h-4 w-4 accent-[var(--color-amber)]" />
                    {ROLE_LABELS[r] ?? r}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-4" disabled={everyone}>
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted">Specific people</legend>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {view.members.map((m) => (
                  <label key={m.id} className={`flex items-center gap-2 text-sm ${everyone ? "text-muted" : "text-ink"}`}>
                    <input type="checkbox" checked={everyone || members.includes(m.id)} onChange={() => toggle(members, setMembers, m.id)}
                      className="h-4 w-4 accent-[var(--color-amber)]" />
                    {m.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-4 block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Reason (shown in the activity log)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Neha now owns the sponsor tasks"
                className="mt-1 h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-amber" />
            </label>
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-conflicting-soft px-3 py-2 text-xs text-conflicting">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Takes effect immediately, including in handovers that are already approved. Removing someone hides these items from them at once.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void save()} loading={saving} data-testid="access-save">Save access</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

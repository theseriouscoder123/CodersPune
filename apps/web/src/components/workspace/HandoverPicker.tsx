"use client";

import { Plus, Target } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Alert, Button, Modal } from "@/components/ui";
import { api, type HandoverRef } from "@/lib/api";
import { useApi } from "@/lib/useApi";

import { useWorkspace } from "./WorkspaceShell";

/** Lists the handovers this persona may see and keeps the selection in ?h=. Returns the selected handover. */
export function useHandoverSelection() {
  const { ws } = useWorkspace();
  const params = useSearchParams();
  const list = useApi<{ handovers: HandoverRef[] }>(`/workspaces/${ws.id}/handovers`);
  const hs = list.data?.handovers ?? [];
  const wanted = params.get("h");
  const selected = hs.find((h) => h.id === wanted) ?? hs[0] ?? null;
  return { handovers: hs, selected, loading: list.loading, error: list.error, reload: list.reload };
}

export function HandoverPicker({ handovers, selected, onCreated }: { handovers: HandoverRef[]; selected: HandoverRef | null; onCreated?: () => void }) {
  const { ws } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const isReviewer = ws.persona.roles.includes("reviewer");
  const [open, setOpen] = useState(false);
  const leaverDefault = ws.members.find((m) => m.roles.includes("leaver"))?.id ?? ws.members[0]?.id;
  const [form, setForm] = useState({ name: "", leaver: leaverDefault ?? "", successor: "", scope: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("h", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ handover: HandoverRef }>(`/workspaces/${ws.id}/handovers`, {
        workspaceId: ws.id, method: "POST",
        body: { name: form.name || null, leaver_member_id: form.leaver, successor_member_id: form.successor, scope: form.scope || null },
      });
      setOpen(false);
      toast(`Handover "${r.handover.name}" created`);
      onCreated?.();
      select(r.handover.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (handovers.length <= 1 && !isReviewer) return null;
  const field = "h-10 w-full rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30";
  return (
    <div className="no-print mt-5 flex flex-wrap items-center gap-2" data-testid="handover-picker">
      {handovers.map((h) => (
        <button key={h.id} onClick={() => select(h.id)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${selected?.id === h.id ? "bg-strong text-on-strong ring-strong" : "bg-card text-ink-2 ring-line hover:ring-ink/25"}`}>
          {h.scope && <Target className="h-3 w-3" />} {h.name}
          {h.latest_version ? <span className="opacity-70">· v{h.latest_version}</span> : <span className="opacity-70">· draft</span>}
        </button>
      ))}
      {isReviewer && !ws.read_only && (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New handover</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} label="New handover">
        <h2 className="font-display text-xl font-semibold text-ink">New handover</h2>
        <p className="mt-1 text-sm text-muted">Hand over the whole project, or just one area (for example when someone rotates to another team).</p>
        <div className="mt-4 space-y-3 text-sm">
          <label className="block"><span className="font-medium text-ink">Name (optional)</span>
            <input className={`${field} mt-1`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Payments module" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="font-medium text-ink">From (leaver)</span>
              <select className={`${field} mt-1`} value={form.leaver} onChange={(e) => setForm({ ...form, leaver: e.target.value })}>
                {ws.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
            <label className="block"><span className="font-medium text-ink">To (successor)</span>
              <select className={`${field} mt-1`} value={form.successor} onChange={(e) => setForm({ ...form, successor: e.target.value })}>
                <option value="">Choose…</option>
                {ws.members.filter((m) => m.id !== form.leaver).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
          </div>
          <label className="block"><span className="font-medium text-ink">Scope (optional)</span>
            <input className={`${field} mt-1`} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="e.g. payments, src/billing/, stripe" />
            <span className="mt-1 block text-xs text-muted">Comma-separated keywords or paths. Only claims whose topic, text or evidence files match are included. Leave empty for the whole project.</span></label>
        </div>
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={busy} disabled={!form.successor} onClick={create}>Create handover</Button>
        </div>
      </Modal>
    </div>
  );
}

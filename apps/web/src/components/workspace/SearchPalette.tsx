"use client";

import { FileText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { StatusChip } from "@/components/ledger/StatusChip";
import { Modal, Spinner } from "@/components/ui";
import { api, type Status, type WorkspaceInfo } from "@/lib/api";

type Results = {
  q: string;
  claims: { id: string; text: string; status: Status; type_label: string; refs: string[] }[];
  passages: { chunk_id: string; source: string; source_type: string; snippet: string; ref: string }[];
};

export function canSearch(ws: WorkspaceInfo) {
  return ws.persona.roles.some((r) => r === "reviewer" || r === "admin" || r === "leaver");
}

/** Ctrl/Cmd+K search across claims and source passages (server-side full-text, permission-filtered). */
export function SearchPalette({ ws }: { ws: WorkspaceInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("baton:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("baton:search", onOpen);
    };
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setBusy(true);
      api<Results>(`/workspaces/${ws.id}/search?q=${encodeURIComponent(text)}`, { workspaceId: ws.id })
        .then((r) => { if (my === seq.current) { setRes(r); setError(null); } })
        .catch((e: unknown) => { if (my === seq.current) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (my === seq.current) setBusy(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [q, ws.id]);

  const close = () => setOpen(false);
  const shown = q.trim().length >= 2 ? res : null;

  return (
    <Modal open={open} onClose={close} label="Search the ledger and sources">
      <div className="-m-2" data-testid="search-palette">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3">
          {busy ? <Spinner className="h-4 w-4 text-muted" /> : <Search className="h-4 w-4 text-muted" />}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claims and sources…" aria-label="Search"
            className="h-11 flex-1 bg-transparent text-sm outline-none" maxLength={120} />
          <kbd className="hidden rounded border border-line px-1.5 text-[10px] text-muted sm:inline">Esc</kbd>
        </div>
        <div className="scroll-quiet mt-3 max-h-[60vh] overflow-auto">
          {error && <p className="px-1 text-sm text-missing">{error}</p>}
          {!shown && !error && <p className="px-1 py-6 text-center text-xs text-muted">Try “push reminders”, “Cloudinary” or “deploy”. Quotes match a phrase; -word excludes.</p>}
          {shown && shown.claims.length === 0 && shown.passages.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted">Nothing you can see matches “{shown.q}”.</p>}
          {shown && shown.claims.length > 0 && (
            <>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Claims</p>
              <ul className="mt-1 space-y-1">
                {shown.claims.map((c) => (
                  <li key={c.id}>
                    <button className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-paper"
                      onClick={() => { close(); router.push(`/w/${ws.id}/review?tab=all&claim=${c.id}`); }}>
                      <StatusChip status={c.status} />
                      <span className="flex-1">
                        <span className="block text-sm text-ink">{c.text}</span>
                        <span className="block text-[11px] text-muted">{c.type_label}{c.refs.length ? ` · ${c.refs.join(" · ")}` : ""}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {shown && shown.passages.length > 0 && (
            <>
              <p className="mt-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">In the sources</p>
              <ul className="mt-1 space-y-1">
                {shown.passages.map((p) => (
                  <li key={p.chunk_id} className="flex items-start gap-2 rounded-lg px-2 py-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <span className="flex-1">
                      <span className="block font-mono text-[11px] text-supported">{p.ref}</span>
                      <span className="block text-sm text-ink-2">{p.snippet.split(/«|»/).map((part, i) => i % 2 ? <mark key={i} className="rounded bg-amber-soft px-0.5 text-ink">{part}</mark> : part)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

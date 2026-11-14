"use client";

import { Check, CheckCircle2, HelpCircle, MessageSquare, RefreshCw, UserX } from "lucide-react";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";

export type AckState = {
  id?: string; state: "acknowledged" | "question" | "not_mine" | null; note?: string | null; answer?: string | null;
  answered_by?: string | null; closed?: boolean; carried?: boolean; changed_since?: number;
};
export type AcksOut = {
  version: number | null; successor: string | null; can_respond: boolean; can_answer: boolean;
  items: Record<string, AckState>;
  counts: { total: number; acknowledged: number; not_mine: number; questions_open: number; questions_answered: number; questions_closed: number; changed: number; untouched: number };
  questions: (AckState & { claim_id: string; text: string; section: string })[];
};

/** Successor's response row under one handover item (Round 3, improvement #3). */
export function AckControls({ hid, wsId, claimId, ack, canRespond, onChanged }: {
  hid: string; wsId: string; claimId: string; ack: AckState | undefined; canRespond: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const state = ack?.state ?? null;

  const send = async (s: "acknowledged" | "question" | "not_mine", text?: string) => {
    setBusy(s);
    try {
      await api(`/handovers/${hid}/acks/${claimId}`, { workspaceId: wsId, method: "PUT", body: { state: s, note: text ?? null } });
      toast(s === "acknowledged" ? "Acknowledged" : s === "question" ? "Question sent to the reviewer" : "Marked as not yours");
      setAsking(false);
      setNote("");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const close = async () => {
    if (!ack?.id) return;
    setBusy("close");
    try {
      await api(`/acks/${ack.id}/close`, { workspaceId: wsId, method: "POST" });
      toast("Question closed");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="no-print mt-2.5 border-t border-line/70 pt-2" onClick={(e) => e.stopPropagation()} data-testid="ack-controls">
      {ack?.changed_since && !state && (
        <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-medium text-amber-ink">
          <RefreshCw className="h-3 w-3" /> Changed since you acknowledged it in version {ack.changed_since}
        </p>
      )}
      {state === "question" && (
        <div className="mb-1.5 rounded-lg bg-paper-2 px-2.5 py-2 text-xs">
          <p className="text-ink-2"><MessageSquare className="mr-1 inline h-3 w-3" />You asked: {ack?.note}</p>
          {ack?.answer ? (
            <p className="mt-1 text-ink"><b>{ack.answered_by ?? "Reviewer"}:</b> {ack.answer}</p>
          ) : <p className="mt-1 text-muted">Waiting for the reviewer&apos;s answer.</p>}
          {ack?.answer && !ack.closed && canRespond && (
            <button onClick={() => void close()} disabled={busy === "close"} className="mt-1.5 font-semibold text-supported hover:underline" data-testid="ack-close">That answers it, close</button>
          )}
          {ack?.closed && <p className="mt-1 text-verified"><CheckCircle2 className="mr-1 inline h-3 w-3" />Closed</p>}
        </div>
      )}
      {state === "not_mine" && <p className="mb-1.5 text-xs text-muted"><UserX className="mr-1 inline h-3 w-3" />You marked this as not yours{ack?.note ? `: ${ack.note}` : ""}.</p>}
      {canRespond && !asking && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => void send("acknowledged")} disabled={!!busy} data-testid="ack-got-it"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${state === "acknowledged" ? "bg-verified-soft text-verified" : "text-ink-2 hover:bg-paper-2"}`}>
            <Check className="h-3.5 w-3.5" /> {state === "acknowledged" ? "Acknowledged" : "Got it"}
          </button>
          <button onClick={() => setAsking(true)} disabled={!!busy} data-testid="ack-ask"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${state === "question" ? "bg-supported-soft text-supported" : "text-ink-2 hover:bg-paper-2"}`}>
            <HelpCircle className="h-3.5 w-3.5" /> {state === "question" ? "Ask again" : "Ask a question"}
          </button>
          <button onClick={() => void send("not_mine")} disabled={!!busy}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${state === "not_mine" ? "bg-paper-2 text-ink" : "text-muted hover:bg-paper-2 hover:text-ink"}`}>
            <UserX className="h-3.5 w-3.5" /> Not mine
          </button>
          {ack?.carried && state === "acknowledged" && <span className="text-[11px] text-muted">from an earlier version, unchanged</span>}
        </div>
      )}
      {canRespond && asking && (
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) void send("question", note.trim()); }}>
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What do you need to know?" aria-label="Your question"
            className="h-8 flex-1 rounded-lg border border-line bg-card px-2.5 text-xs outline-none focus:border-amber" data-testid="ack-question" />
          <Button size="sm" type="submit" loading={busy === "question"} disabled={note.trim().length < 3}>Send</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(false)}>Cancel</Button>
        </form>
      )}
    </div>
  );
}

/** Progress for whoever is looking: the successor sees their own; the reviewer sees the successor's. */
export function AckProgress({ acks }: { acks: AcksOut }) {
  const c = acks.counts;
  const done = c.acknowledged + c.not_mine + c.questions_closed;
  const pct = c.total ? Math.round((100 * done) / c.total) : 0;
  return (
    <div className="no-print mt-5 rounded-xl bg-paper/70 px-3 py-2.5 ring-1 ring-line" data-testid="ack-progress">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink">{acks.can_respond ? "Your progress" : `${acks.successor ?? "The successor"}'s progress`}: {done} of {c.total} items done</span>
        <span className="text-muted">
          {c.questions_open > 0 && <span className="mr-2 text-supported">{c.questions_open} question{c.questions_open > 1 ? "s" : ""} waiting</span>}
          {c.questions_answered > 0 && <span className="mr-2 text-verified">{c.questions_answered} answered</span>}
          {c.changed > 0 && <span className="text-amber-ink">{c.changed} changed since acknowledged</span>}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2"><div className="h-full rounded-full bg-verified-solid transition-all duration-500" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Reviewer: the successor's open questions, answered in place. */
export function ReviewerQuestions({ acks, wsId, onChanged }: { acks: AcksOut; wsId: string; onChanged: () => void }) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const list = acks.questions;
  if (list.length === 0) return null;
  const answer = async (id: string) => {
    setBusy(id);
    try {
      await api(`/acks/${id}/answer`, { workspaceId: wsId, method: "POST", body: { answer: (drafts[id] ?? "").trim() } });
      toast("Answer sent");
      setDrafts((d) => ({ ...d, [id]: "" }));
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="no-print mt-6 p-5" data-testid="reviewer-questions">
      <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><MessageSquare className="h-4 w-4 text-supported" /> From {acks.successor ?? "the successor"}</p>
      <p className="text-xs text-muted">Questions and items marked “not mine”. Answer here; they close the question when it&apos;s answered.</p>
      <ul className="mt-3 space-y-2">
        {list.map((q) => (
          <li key={q.claim_id} className="rounded-xl border border-line bg-paper/50 p-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{q.section}</p>
            <p className="mt-0.5 text-ink">{q.text}</p>
            {q.state === "not_mine" ? (
              <p className="mt-1.5 text-xs text-muted"><UserX className="mr-1 inline h-3 w-3" />Marked as not theirs{q.note ? `: ${q.note}` : ""}.</p>
            ) : (
              <>
                <p className="mt-1.5 text-xs text-supported"><HelpCircle className="mr-1 inline h-3 w-3" />{q.note}</p>
                {q.answer ? (
                  <p className="mt-1 text-xs text-ink-2"><b>You:</b> {q.answer} {q.closed ? <span className="text-verified">· closed</span> : <span className="text-muted">· waiting for them to close it</span>}</p>
                ) : acks.can_answer && q.id ? (
                  <div className="mt-2 flex gap-1.5">
                    <input value={drafts[q.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [q.id!]: e.target.value }))} maxLength={1000}
                      placeholder="Your answer" aria-label="Your answer" data-testid="answer-question"
                      className="h-9 flex-1 rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-amber" />
                    <Button size="sm" loading={busy === q.id} disabled={(drafts[q.id] ?? "").trim().length < 2} onClick={() => void answer(q.id!)}>Answer</Button>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

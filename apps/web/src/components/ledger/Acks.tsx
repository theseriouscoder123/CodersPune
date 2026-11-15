"use client";

import { Check, CheckCircle2, MessageSquare, RefreshCw, UserX } from "lucide-react";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui";
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

/** The successor's response for one handover item (Round 3, improvement #3): a check circle ("Got it"), the item
 *  content, the question thread, and hover actions (Ask a question, Not mine). Server-side rules decide everything. */
export function AckControls({ hid, wsId, claimId, ack, canRespond, onChanged, children, aside }: {
  hid: string; wsId: string; claimId: string; ack: AckState | undefined; canRespond: boolean; onChanged: () => void;
  children?: React.ReactNode; aside?: React.ReactNode;
}) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const state = ack?.state ?? null;
  const done = state === "acknowledged";

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
    <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1 sm:flex-nowrap" data-testid="ack-controls">
      {canRespond ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); void send("acknowledged"); }} disabled={!!busy} data-testid="ack-got-it"
          title={done ? "Acknowledged" : "Mark as got it"} aria-pressed={done}
          className={`no-print relative mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors before:absolute before:-inset-[9px] before:content-[''] ${done ? "border-ver bg-ver text-white" : "border-line-2 bg-bg text-transparent hover:border-fg-3 hover:text-fg-4"}`}>
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
          <span className="sr-only">{done ? "Acknowledged" : "Got it"}</span>
        </button>
      ) : null}
      <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-30px)]">
        {children}
        {ack?.changed_since && !state && (
          <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-con"><RefreshCw className="h-3 w-3" /> Changed since you acknowledged it in version {ack.changed_since}</p>
        )}
        {state === "question" && (
          <div className="no-print mt-2 rounded-md border border-line bg-bg-sunk px-2.5 py-2 text-[12.5px] leading-[18px]" onClick={(e) => e.stopPropagation()}>
            <p className="text-fg-2"><MessageSquare className="mr-1 inline h-3 w-3 text-fg-3" />You asked: {ack?.note}</p>
            {ack?.answer ? (
              <p className="mt-1 text-fg"><b className="font-semibold">{ack.answered_by ?? "Reviewer"}:</b> {ack.answer}</p>
            ) : <p className="mt-1 text-fg-3">Waiting for the reviewer&apos;s answer.</p>}
            {ack?.answer && !ack.closed && canRespond && (
              <button onClick={() => void close()} disabled={busy === "close"} className="mt-1 font-medium text-accent-ink hover:underline" data-testid="ack-close">That answers it, close</button>
            )}
            {ack?.closed && <p className="mt-1 text-ver"><CheckCircle2 className="mr-1 inline h-3 w-3" />Closed</p>}
          </div>
        )}
        {state === "not_mine" && <p className="mt-1 text-[12px] text-fg-3"><UserX className="mr-1 inline h-3 w-3" />You marked this as not yours{ack?.note ? `: ${ack.note}` : ""}.</p>}
        {ack?.carried && done && <p className="mt-0.5 text-[11.5px] text-fg-3">Acknowledged in an earlier version, unchanged</p>}
        {canRespond && asking && (
          <form className="no-print mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) void send("question", note.trim()); }}>
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What do you need to know?" aria-label="Your question"
              className="h-8 min-w-[12rem] flex-1 rounded-md border border-line-2 bg-bg px-2.5 text-[13px] text-fg outline-none focus:ring-2 focus:ring-[var(--ring)]" data-testid="ack-question" />
            <Button size="sm" type="submit" loading={busy === "question"} disabled={note.trim().length < 3}>Send</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(false)}>Cancel</Button>
            {done && <p className="w-full text-[12px] text-fg-3">Asking replaces your &quot;Got it&quot; on this item until the question is closed.</p>}
          </form>
        )}
      </div>
      {canRespond && !asking && (
        <div className="no-print flex shrink-0 items-center gap-0.5 max-sm:ml-[24px] opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setAsking(true)} disabled={!!busy} data-testid="ack-ask"
            className="h-8 rounded px-1.5 text-[12px] font-medium text-fg-2 hover:bg-hover hover:text-fg sm:h-6">{state === "question" ? "Ask again" : "Ask a question"}</button>
          <button type="button" onClick={() => void send("not_mine")} disabled={!!busy}
            className={`h-8 rounded px-1.5 text-[12px] font-medium hover:bg-hover sm:h-6 hover:text-fg ${state === "not_mine" ? "text-fg" : "text-fg-3"}`}>Not mine</button>
        </div>
      )}
      {aside}
    </div>
  );
}

/** Progress for whoever is looking: the successor sees their own; the reviewer sees the successor's. */
export function AckProgress({ acks }: { acks: AcksOut }) {
  const c = acks.counts;
  const done = c.acknowledged + c.not_mine + c.questions_closed;
  const waiting = c.questions_open;
  const pct = (n: number) => (c.total ? `${(100 * n) / c.total}%` : "0%");
  return (
    <div className="no-print" data-testid="ack-progress">
      <p className="text-[12px] font-medium text-fg-3">{acks.can_respond ? "Your progress" : `${acks.successor ?? "The successor"}'s progress`}</p>
      <p className="mt-1 text-[13px] text-fg"><b className="text-[16px] font-semibold">{done}</b> <span className="text-fg-3">of {c.total} items done</span></p>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden>
        <span className="h-full bg-ver" style={{ width: pct(done) }} />
        <span className="h-full bg-accent" style={{ width: pct(waiting) }} />
      </div>
      <ul className="mt-2 space-y-0.5 text-[12px] text-fg-3">
        <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-ver" />{c.acknowledged} got it{c.not_mine ? ` · ${c.not_mine} not theirs` : ""}</li>
        {waiting > 0 && <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" />{waiting} question{waiting > 1 ? "s" : ""} waiting</li>}
        {c.questions_answered > 0 && <li>{c.questions_answered} answered, to close</li>}
        {c.changed > 0 && <li className="text-con">{c.changed} changed since acknowledged</li>}
      </ul>
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
    <section className="no-print mt-8" data-testid="reviewer-questions">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg"><MessageSquare className="h-4 w-4 text-fg-3" /> From {acks.successor ?? "the successor"} <span className="text-[13px] font-normal text-fg-3">{list.length}</span></h2>
      <p className="mt-0.5 text-[12.5px] text-fg-3">Questions and items marked “not mine”. Answer here; they close the question once it&apos;s answered.</p>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
        {list.map((q) => (
          <li key={q.claim_id} className="px-3.5 py-3 text-[13px]">
            <p className="text-[12px] text-fg-3">{q.section}</p>
            <p className="mt-0.5 text-fg">{q.text}</p>
            {q.state === "not_mine" ? (
              <p className="mt-1.5 text-[12.5px] text-fg-3"><UserX className="mr-1 inline h-3 w-3" />Marked as not theirs{q.note ? `: ${q.note}` : ""}.</p>
            ) : (
              <>
                <p className="mt-1.5 text-[12.5px] text-accent-ink"><MessageSquare className="mr-1 inline h-3 w-3" />{q.note}</p>
                {q.answer ? (
                  <p className="mt-1 text-[12.5px] text-fg-2"><b className="font-semibold">You:</b> {q.answer} {q.closed ? <span className="text-ver">· closed</span> : <span className="text-fg-3">· waiting for them to close it</span>}</p>
                ) : acks.can_answer && q.id ? (
                  <div className="mt-2 flex gap-1.5">
                    <input value={drafts[q.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [q.id!]: e.target.value }))} maxLength={1000}
                      placeholder="Your answer" aria-label="Your answer" data-testid="answer-question"
                      className="h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-bg px-2.5 text-[13px] text-fg outline-none focus:ring-2 focus:ring-[var(--ring)]" />
                    <Button size="sm" loading={busy === q.id} disabled={(drafts[q.id] ?? "").trim().length < 2} onClick={() => void answer(q.id!)}>Answer</Button>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

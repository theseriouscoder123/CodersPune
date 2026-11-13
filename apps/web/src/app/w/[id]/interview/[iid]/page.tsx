"use client";

import { ArrowLeft, ArrowRight, Check, CheckCircle2, HelpCircle, Mic, Pencil, Plus, Send, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import type { InterviewQuestion, InterviewView } from "@/components/interview/types";
import { useToast } from "@/components/Toast";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, Card, EmptyState, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const KIND: Record<InterviewQuestion["kind"], { label: string; tone: string }> = {
  missing: { label: "Missing from the sources", tone: "bg-missing-soft text-missing ring-missing/20" },
  conflict: { label: "Sources disagree", tone: "bg-conflicting-soft text-conflicting ring-conflicting/20" },
  custom: { label: "From the reviewer", tone: "bg-supported-soft text-supported ring-supported/20" },
};

export default function InterviewPage() {
  const { iid } = useParams<{ iid: string }>();
  const { ws, switchPersona } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const res = useApi<InterviewView>(`/interviews/${iid}`);
  const [view, setView] = useState<InterviewView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const iv = view && view.id === iid ? view : res.data ?? null;

  useEffect(() => {
    document.title = iv ? `${iv.status === "submitted" ? "✓ " : ""}Gap interview · ${iv.counts.answered}/${iv.counts.total} · Baton` : "Gap interview · Baton";
  }, [iv]);

  if (res.status === 404) {
    return (
      <div className="mx-auto max-w-lg pt-6">
        <EmptyState icon={<Mic className="h-5 w-5" />} title="Interview not available">
          This interview doesn&apos;t exist, hasn&apos;t been sent to {ws.persona.name}, or was discarded.
        </EmptyState>
      </div>
    );
  }
  if (!iv) return res.error ? <Alert tone="error">{res.error}</Alert> : <SkeletonList rows={4} />;

  const act = async (key: string, fn: () => Promise<InterviewView>, ok?: string) => {
    setBusy(key);
    try {
      const v = await fn();
      setView(v);
      if (ok) toast(ok);
      return v;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return null;
    } finally {
      setBusy(null);
    }
  };
  const call = (path: string, method: string, body?: unknown) => api<InterviewView>(path, { workspaceId: ws.id, method, body });
  const base = `/interviews/${iv.id}`;
  const reviewer = ws.members.find((m) => m.roles.includes("reviewer"));
  const respondentId = iv.respondent.id;
  const isRespondent = respondentId === ws.persona.id;
  const answering = iv.can_answer;
  const pct = iv.counts.total ? Math.round((iv.counts.answered / iv.counts.total) * 100) : 0;

  async function send() {
    const v = await act("send", () => call(`${base}/send`, "POST"));
    if (!v) return;
    const mailed = v.emailed?.status === "sent";
    toast(mailed ? `Sent to ${v.respondent.name}, with an email` : `Sent to ${v.respondent.name}`);
  }

  async function discard() {
    if (!(await confirm({ title: "Discard these questions?", body: "Nothing has been answered yet, so nothing is lost from the ledger.", confirmLabel: "Discard", tone: "danger" }))) return;
    setBusy("discard");
    try {
      await api(`${base}`, { workspaceId: ws.id, method: "DELETE" });
      toast("Interview discarded");
      router.push(`/w/${ws.id}/review?tab=missing`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(null);
    }
  }

  async function submit() {
    const open = iv!.counts.total - iv!.counts.answered;
    if (!(await confirm({
      title: "Submit your answers?",
      body: (
        <>
          Your answers become a cited source labelled <b>leaver testimony</b>, and the reviewer checks them before anything reaches the
          successor. You can&apos;t change them after submitting.{open > 0 && <> {open} question{open > 1 ? "s are" : " is"} still unanswered and will be left open.</>}
        </>
      ),
      confirmLabel: "Submit answers",
    }))) return;
    const v = await act("submit", () => call(`${base}/submit`, "POST"));
    if (v) toast(`Submitted. ${v.created ?? 0} testimony claim${v.created === 1 ? "" : "s"} added to the ledger`);
  }

  async function resolveAsSuggested(q: InterviewQuestion) {
    if (!q.conflict_group_id || !q.chosen_claim_id) return;
    setBusy(`resolve-${q.id}`);
    try {
      await api(`/conflicts/${q.conflict_group_id}/resolve`, { workspaceId: ws.id, method: "POST",
        body: { winner_claim_id: q.chosen_claim_id, note: `Resolved as ${iv!.respondent.name} said in the gap interview` } });
      toast("Conflict resolved. The other claim is marked superseded");
      res.reload();
      setView(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const title = iv.is_reviewer && !iv.on_behalf ? `Questions for ${iv.respondent.name}`
    : iv.on_behalf ? `Answering for ${iv.respondent.name}` : "A few questions before you hand over";

  return (
    <div className="mx-auto max-w-3xl" data-testid="interview">
      <Link href={iv.is_reviewer ? `/w/${ws.id}/review?tab=missing` : `/w/${ws.id}/sources`} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> {iv.is_reviewer ? "Back to Review" : "Back to the workspace"}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">Gap interview</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {iv.is_reviewer
              ? "Baton couldn't answer these from the project's sources. Answers become cited “leaver testimony”: they go through the same evidence and permission checks as every other source, and you review them before approval."
              : `${iv.created_by} is preparing the handover. Baton couldn't find these answers in the project, and you're the person who knows. Your answers are saved as you go.`}
          </p>
        </div>
        <StatusBadge iv={iv} />
      </div>

      {/* Progress */}
      {iv.status !== "draft" && (
        <div className="mt-5" aria-label={`${iv.counts.answered} of ${iv.counts.total} answered`}>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{iv.counts.answered} of {iv.counts.total} answered</span>
            {iv.minutes_to_answer != null && <span>Took {iv.minutes_to_answer} min</span>}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2"><div className="h-full rounded-full bg-amber transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {/* Reviewer waiting on the leaver (demo: offer to play the leaver) */}
      {iv.status === "sent" && iv.is_reviewer && !iv.on_behalf && (
        <Alert tone="info" className="mt-5">
          Waiting for {iv.respondent.name}. They&apos;ll see a banner in this workspace{ws.synthetic ? "" : " (and an email, if their address is on the Team page)"}.
          {ws.synthetic && respondentId && switchPersona && (
            <Button size="sm" variant="secondary" className="ml-2 mt-2 sm:mt-0" data-testid="play-leaver"
              onClick={() => switchPersona(respondentId)}>
              <UserRound className="h-4 w-4" /> Switch to {iv.respondent.name} and answer
            </Button>
          )}
        </Alert>
      )}
      {iv.status === "submitted" && iv.is_reviewer && (
        <Alert tone="success" className="mt-5">
          {iv.respondent.name}&apos;s answers are in the ledger as leaver testimony. Check them in Review, accept or reject the suggested conflict
          resolutions below, then approve a new version so the successor gets them.
        </Alert>
      )}
      {iv.status === "submitted" && !iv.is_reviewer && (
        <Alert tone="success" className="mt-5">Thank you. {reviewer?.name ?? "The reviewer"} will check your answers before they reach whoever takes over.</Alert>
      )}

      <ol className="mt-6 space-y-3">
        {iv.questions.map((q, i) => (
          <QuestionCard key={q.id} q={q} index={i + 1} iv={iv} wsId={ws.id} busy={busy} answering={answering}
            onEdit={(text) => act(`edit-${q.id}`, () => call(`${base}/questions/${q.id}`, "PATCH", { question: text }), "Question updated")}
            onDrop={() => act(`drop-${q.id}`, () => call(`${base}/questions/${q.id}`, "DELETE"), "Question removed")}
            onAnswer={(body) => act(`ans-${q.id}`, () => call(`${base}/questions/${q.id}/answer`, "PUT", body), "Saved")}
            onResolve={() => void resolveAsSuggested(q)} />
        ))}
      </ol>

      {iv.can_edit && <AddQuestion busy={busy === "add"} onAdd={(text) => act("add", () => call(`${base}/questions`, "POST", { question: text }), "Question added")} />}

      {/* Footer actions */}
      {iv.status === "draft" && iv.can_edit && (
        <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card/95 px-4 py-3 shadow-[var(--shadow-lg)] backdrop-blur">
          <p className="text-sm text-ink-2">{iv.counts.total} question{iv.counts.total === 1 ? "" : "s"} for {iv.respondent.name}. Edit or remove any before sending.</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" loading={busy === "discard"} onClick={() => void discard()}>Discard</Button>
            <Button size="sm" loading={busy === "send"} onClick={() => void send()} data-testid="send-interview"><Send className="h-4 w-4" /> Send to {iv.respondent.name}</Button>
          </div>
        </div>
      )}
      {answering && (
        <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card/95 px-4 py-3 shadow-[var(--shadow-lg)] backdrop-blur">
          <p className="text-sm text-ink-2">{iv.counts.answered === 0 ? "Answer at least one question to submit." : `${iv.counts.answered} of ${iv.counts.total} answered. Skipped questions stay open.`}</p>
          <Button size="sm" loading={busy === "submit"} disabled={iv.counts.answered === 0} onClick={() => void submit()} data-testid="submit-interview">
            <Check className="h-4 w-4" /> Submit answers
          </Button>
        </div>
      )}
      {!answering && !iv.is_reviewer && iv.status === "sent" && !isRespondent && (
        <Alert tone="warn" className="mt-6">These questions were sent to {iv.respondent.name}.</Alert>
      )}
      {iv.status === "submitted" && iv.is_reviewer && (
        <div className="mt-6 flex justify-end">
          <Link href={`/w/${ws.id}/review/preview`} className="inline-flex items-center gap-1 text-sm font-semibold text-ink hover:underline">
            Preview and approve a new version <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ iv }: { iv: InterviewView }) {
  const m = {
    draft: ["Draft · not sent", "bg-paper-2 text-ink-2 ring-line"],
    sent: [iv.on_behalf ? "Answering on their behalf" : iv.is_reviewer ? `Sent · waiting for ${iv.respondent.name}` : "Waiting for your answers", "bg-amber-soft text-amber-ink ring-amber/30"],
    submitted: ["Answered", "bg-verified-soft text-verified ring-verified/25"],
    closed: ["Closed", "bg-paper-2 text-ink-2 ring-line"],
  }[iv.status];
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${m[1]}`} data-testid="interview-status">{m[0]}</span>;
}

type AnswerBody = { answer_kind: InterviewQuestion["answer_kind"]; answer?: string; chosen_claim_id?: string; ask_who?: string };

function QuestionCard({ q, index, iv, wsId, busy, answering, onEdit, onDrop, onAnswer, onResolve }: {
  q: InterviewQuestion; index: number; iv: InterviewView; wsId: string; busy: string | null; answering: boolean;
  onEdit: (t: string) => Promise<unknown>; onDrop: () => Promise<unknown>; onAnswer: (b: AnswerBody) => Promise<unknown>; onResolve: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.question);
  const [answer, setAnswer] = useState(q.answer_kind === "answered" ? q.answer ?? "" : "");
  const [choice, setChoice] = useState(q.chosen_claim_id ?? "");
  const [asking, setAsking] = useState(q.answer_kind === "ask_other");
  const [who, setWho] = useState(q.ask_who ?? "");
  const saving = busy === `ans-${q.id}`;
  const done = !!q.answer_kind;
  const k = KIND[q.kind];
  const chosen = q.options.find((o) => o.claim_id === q.chosen_claim_id);

  return (
    <li>
      <Card className={`p-5 transition ${done && answering ? "ring-1 ring-verified/30" : ""}`} data-testid="interview-question">
        <div className="flex items-start gap-3">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-verified text-white" : "bg-paper-2 text-ink-2"}`}>
            {done ? <Check className="h-3.5 w-3.5" /> : index}
          </span>
          <div className="min-w-0 flex-1">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${k.tone}`}>{k.label}</span>
            {editing ? (
              <div className="mt-2 flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Question text"
                  className="h-10 flex-1 rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-amber" />
                <Button size="sm" loading={busy === `edit-${q.id}`} onClick={async () => { await onEdit(text); setEditing(false); }}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setText(q.question); setEditing(false); }} aria-label="Cancel"><X className="h-4 w-4" /></Button>
              </div>
            ) : (
              <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{q.question}</p>
            )}
            {q.context && <p className="mt-1 text-xs text-muted">{q.context}</p>}
          </div>
          {iv.can_edit && !editing && (
            <div className="flex shrink-0 gap-1">
              {q.kind !== "conflict" && (
                <button type="button" onClick={() => setEditing(true)} aria-label="Edit question" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-paper-2 hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
              )}
              <button type="button" onClick={() => void onDrop()} aria-label="Remove question" disabled={busy === `drop-${q.id}`}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-missing-soft hover:text-missing"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>

        {/* Conflict options (read-only for the reviewer while drafting) */}
        {q.kind === "conflict" && (
          <div className="mt-3 space-y-2 sm:pl-10" role={answering ? "radiogroup" : undefined} aria-label="Which one is current?">
            {q.options.map((o) => {
              const picked = (answering ? choice : q.chosen_claim_id) === o.claim_id;
              return (
                <label key={o.claim_id} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
                  picked ? "border-amber bg-amber-soft/50" : "border-line bg-paper hover:border-line-2"} ${answering ? "" : "cursor-default"}`}>
                  {answering && <input type="radio" name={`q-${q.id}`} checked={choice === o.claim_id} onChange={() => setChoice(o.claim_id)} className="mt-0.5 h-4 w-4 accent-[var(--color-amber)]" />}
                  <span className="min-w-0">
                    <span className="block text-ink">{o.text}</span>
                    {o.ref && <span className="mt-0.5 block font-mono text-[11px] text-supported">{o.ref}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {/* Answering */}
        {answering && (
          <div className="mt-3 sm:pl-10">
            {q.kind !== "conflict" && !asking && (
              <div>
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000} rows={3} aria-label={`Answer to question ${index}`}
                  placeholder="Type what you know. Short is fine."
                  className="w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-amber" />
                <p className="mt-0.5 text-right text-[11px] text-muted">{answer.length}/1000</p>
              </div>
            )}
            {asking && (
              <label className="block text-sm">
                <span className="text-xs text-muted">Who would know?</span>
                <input value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} placeholder="A name or a team"
                  className="mt-1 h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-amber" />
              </label>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" loading={saving} data-testid="save-answer"
                disabled={asking ? who.trim().length < 2 : q.kind === "conflict" ? !choice : answer.trim().length < 2}
                onClick={() => void onAnswer(asking ? { answer_kind: "ask_other", ask_who: who.trim() }
                  : q.kind === "conflict" ? { answer_kind: "chose_option", chosen_claim_id: choice } : { answer_kind: "answered", answer: answer.trim() })}>
                {done ? "Update answer" : "Save answer"}
              </Button>
              {!asking && <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Someone else would know</Button>}
              {asking && <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>I&apos;ll answer it</Button>}
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setAsking(false); void onAnswer({ answer_kind: "dont_know" }); }}>
                <HelpCircle className="h-4 w-4" /> I don&apos;t know
              </Button>
              {done && <span className="text-xs text-verified"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{q.answer_kind === "dont_know" ? "Marked as unknown" : "Saved"}</span>}
            </div>
          </div>
        )}

        {/* Read-only answer (reviewer, or after submitting) */}
        {!answering && done && (
          <div className="mt-3 rounded-xl bg-paper px-3 py-2.5 text-sm sm:ml-10">
            {q.answer_kind === "answered" && <p className="text-ink"><span className="text-xs font-semibold text-muted">{iv.respondent.name}: </span>{q.answer}</p>}
            {q.answer_kind === "dont_know" && <p className="text-muted">{iv.respondent.name} doesn&apos;t know. This stays an open question.</p>}
            {q.answer_kind === "ask_other" && <p className="text-ink">{iv.respondent.name} says to ask <b>{q.ask_who}</b>.</p>}
            {q.answer_kind === "chose_option" && chosen && <p className="text-ink">{iv.respondent.name} says this is current: <b>“{chosen.text}”</b></p>}
            {iv.is_reviewer && iv.status === "submitted" && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {q.testimony_claim_id && (
                  <Link href={`/w/${wsId}/review?tab=all&claim=${q.testimony_claim_id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-supported hover:underline" data-testid="open-testimony">
                    Open the testimony claim <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
                {q.answer_kind === "chose_option" && (q.conflict_resolved
                  ? <span className="text-xs text-verified"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Conflict resolved</span>
                  : <Button size="sm" variant="secondary" loading={busy === `resolve-${q.id}`} onClick={onResolve} data-testid="resolve-as-suggested">Resolve as {iv.respondent.name} says</Button>)}
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function AddQuestion({ busy, onAdd }: { busy: boolean; onAdd: (t: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  return (
    <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (text.trim().length < 3) return; const ok = await onAdd(text.trim()); if (ok) setText(""); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add your own question for the leaver…" aria-label="New question"
        className="h-10 flex-1 rounded-xl border border-dashed border-line-2 bg-card px-3 text-sm outline-none focus:border-amber" />
      <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={text.trim().length < 3}><Plus className="h-4 w-4" /> Add</Button>
    </form>
  );
}

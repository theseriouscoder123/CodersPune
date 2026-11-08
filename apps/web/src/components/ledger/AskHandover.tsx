"use client";

import { ArrowRight, HelpCircle, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/ledger/StatusChip";
import { Alert, Card, Spinner } from "@/components/ui";
import { api, type HandoverItem, type Status } from "@/lib/api";

type Citation = { claim_id: string; text: string; status: Status; type_label: string; evidence: HandoverItem["evidence"]; status_reason: string; flags: HandoverItem["flags"] };
type Answer = { answered: boolean; partial?: boolean; answer: string | null; citations: Citation[]; fallback: string | null };

const SUGGESTIONS = ["What should I do first?", "Who owns deployments?", "What's risky right now?", "What is still unknown?"];

export function AskHandover({ handoverId, workspaceId, onOpenEvidence }:
  { handoverId: string; workspaceId: string; onOpenEvidence: (item: HandoverItem) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ question: string; answer?: Answer; error?: string } | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 3) return;
    setBusy(true);
    setRes({ question: text });
    try {
      const a = await api<Answer>(`/handovers/${handoverId}/ask`, { workspaceId, method: "POST", body: { question: text } });
      setRes({ question: text, answer: a });
    } catch (e) {
      setRes({ question: text, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="no-print mt-5 p-5" data-testid="ask-handover">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-supported-soft text-supported"><MessageCircleQuestion className="h-4 w-4" /></span>
        <div>
          <p className="font-semibold text-ink">Ask the handover</p>
          <p className="text-xs text-muted">Answers come only from approved items you&apos;re allowed to see, and always cite them.</p>
        </div>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="e.g. Why did we move off OneSignal?"
          className="h-11 flex-1 rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" aria-label="Your question" />
        <button type="submit" disabled={busy || q.trim().length < 3}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong transition hover:bg-strong/90 disabled:opacity-50">
          {busy ? <Spinner /> : <Send className="h-4 w-4" />} Ask
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => { setQ(s); void ask(s); }} disabled={busy}
            className="rounded-full bg-paper px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line transition hover:ring-ink/25 disabled:opacity-50">{s}</button>
        ))}
      </div>

      {res && (
        <div className="animate-rise mt-4 rounded-xl border border-line bg-paper/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">You asked</p>
          <p className="text-sm text-ink">{res.question}</p>
          {busy && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Spinner /> Reading the approved handover…</p>}
          {res.error && <Alert tone="error" className="mt-3">{res.error}</Alert>}
          {res.answer && (res.answer.answer ? (
            <div className="mt-3">
              <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${res.answer.partial ? "text-amber-ink" : "text-supported"}`}>
                <Sparkles className="h-3 w-3" /> {res.answer.partial ? "Partial answer from the handover" : "Answer from the handover"}
              </p>
              <p className="mt-1 whitespace-pre-line text-[14.5px] leading-relaxed text-ink">{res.answer.answer}</p>
              {res.answer.partial && res.answer.fallback && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-soft/70 px-3 py-2 text-xs text-amber-ink"><HelpCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {res.answer.fallback}</p>
              )}
              <p className="mt-3 text-xs font-semibold text-muted">Based on</p>
              <ul className="mt-1 space-y-1.5">
                {res.answer.citations.map((c, i) => (
                  <li key={c.claim_id}>
                    <button onClick={() => onOpenEvidence({ ...c, type: c.type_label, occurred_at: null })} className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-card">
                      <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted">[{i + 1}]</span>
                      <StatusChip status={c.status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} />
                      <span className="flex-1 text-sm text-ink-2">{c.text}</span>
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted transition group-hover:translate-x-0.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-missing-soft/60 px-3 py-2 text-sm text-missing"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0" /> {res.answer.fallback}</p>
          ))}
        </div>
      )}
    </Card>
  );
}

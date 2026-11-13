import {
  ArrowRight, BellRing, Download, Eye, FileSearch, GitBranch, Github, Handshake, KeyRound, Lock, MessageCircleQuestion,
  RefreshCcw, Scale, ShieldCheck, UserCheck, UsersRound,
} from "lucide-react";

import { ApiStatus } from "@/components/ApiStatus";
import { Logo } from "@/components/Logo";
import { StatusChip } from "@/components/ledger/StatusChip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TryDemoButton } from "@/components/TryDemoButton";
import { ButtonLink } from "@/components/ui";
import type { Status } from "@/lib/api";

const STEPS = [
  { name: "Connect", Icon: GitBranch, text: "Bring in a repo, meeting notes and chat. Each source is tagged with who may read it; secrets are stripped on the way in." },
  { name: "Reconstruct", Icon: FileSearch, text: "Decisions, owners, open work, risks and contacts become single claims, each tied to an exact quote." },
  { name: "Verify", Icon: Scale, text: "Every quote is matched against its source and checked by a separate model. Rules, not the AI, set the status." },
  { name: "Review", Icon: UserCheck, text: "A reviewer confirms, fixes or rejects claims and previews exactly what the successor will see." },
  { name: "Handover", Icon: Handshake, text: "The successor gets a continuation plan filtered to their access, with every gap marked." },
];

const LEDGER: { type: string; text: string; ref: string; status: Status }[] = [
  { type: "Decision", text: "Push reminders moved from OneSignal to FCM because the free plan capped devices.", ref: "PR #88 · #dev 12 Mar", status: "verified" },
  { type: "Ownership", text: "Rohan is effectively the only maintainer of the deploy workflow.", ref: "deploy.yml · 31 of 33 commits", status: "supported" },
  { type: "Risk", text: "Upload limit: meeting notes say 5 MB, code enforces 2 MB.", ref: "Notes 2 Apr · upload.ts:41", status: "conflicting" },
  { type: "Contact", text: "Who owns the Firebase project and its billing account?", ref: "FIREBASE_* in .env.example", status: "missing" },
];

const FEATURES = [
  { Icon: MessageCircleQuestion, title: "Ask the handover", text: "Successors ask in plain English and get answers built only from approved items they may see, with numbered citations." },
  { Icon: UsersRound, title: "Private links per person", text: "Lock identities so everyone sees the project only as themselves. Revoking a link signs that person out." },
  { Icon: RefreshCcw, title: "Re-runs keep your review work", text: "Refresh reads only what changed. If a source is edited, evidence follows its quote, or the claim is flagged for review." },
  { Icon: BellRing, title: "Email and Slack, when you want them", text: "Tell the successor when a version is approved and send open questions to the leaver. Messages never include claim text." },
  { Icon: Download, title: "Your data stays yours", text: "Export a whole workspace as JSON, print the handover, or delete everything with one confirmed action." },
  { Icon: KeyRound, title: "Works with what you have", text: "Public or private GitHub repos, Markdown, PDF and Word notes, and Slack or Discord exports." },
];

const SECURITY = [
  "Secrets and tokens are removed before anything is stored or sent to a model",
  "Access is checked on the server at every read, never only in the browser",
  "A claim is visible only if every source it cites is visible to you",
  "Private-repo tokens are used once and never stored",
  "Phone numbers and emails are masked for everyone but the reviewer",
  "Every review decision is recorded in an append-only activity log",
];

const PRINCIPLES = [
  { Icon: ShieldCheck, title: "Assumptions never pass as fact", text: "A claim is Supported only if its quote is found verbatim in the source and an independent check agrees. Anything else is labelled Inferred and kept away from the successor." },
  { Icon: Lock, title: "Access is enforced on the server", text: "A claim is shown only if every source it cites is readable by that person. Restricted text is never mixed into what others see." },
  { Icon: Eye, title: "A human approves every handover", text: "Nothing reaches the successor until a reviewer has read the evidence, resolved conflicts and approved a version." },
];

export default function Home() {
  return (
    <div className="paper-grain flex flex-1 flex-col overflow-x-clip">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#how" className="hidden whitespace-nowrap rounded-lg px-3 py-2 text-ink-2 hover:bg-paper-2 sm:block">How it works</a>
          <a href="#trust" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-paper-2 sm:block">Trust</a>
          <a href="#security" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-paper-2 md:block">Security</a>
          <ThemeToggle />
          <ButtonLink href="/new" variant="secondary" size="sm" className="ml-1 whitespace-nowrap">Use your repo</ButtonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-2">
              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-amber" /> Knowledge handover for small software teams
            </p>
            <h1 className="font-display mt-5 max-w-[19ch] text-[40px] font-semibold leading-[1.04] tracking-[-0.01em] text-ink [text-wrap:balance] sm:text-[48px] lg:text-[54px]">
              When someone leaves, keep the <em className="font-normal italic text-amber-ink">reasoning</em>, not just the files.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
              Baton rebuilds a project&apos;s decisions, owners, risks and open work from its repo, notes and chat. Every statement
              is linked to a source and graded by its evidence, and nothing reaches the successor until a person approves it.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-start">
              <TryDemoButton />
              <ButtonLink href="/new" variant="secondary" size="lg" data-testid="start-repo">
                Start with a public GitHub repo <ArrowRight className="h-4 w-4" />
              </ButtonLink>
            </div>
            <p className="mt-3 text-xs text-muted">
              The demo is a fictional student-club project, opened in your own copy so nothing you do affects other visitors. No sign-up.
            </p>
          </div>

          <div className="animate-rise relative" style={{ animationDelay: "120ms" }}>
            <div className="absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br from-amber-soft via-transparent to-supported-soft opacity-70 blur-2xl" />
            <div className="rounded-3xl border border-line bg-card p-5 shadow-[var(--shadow-lg)]">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Handover ledger</p>
                  <p className="font-display text-lg font-semibold text-ink">Campus Events App · Rohan → Neha</p>
                </div>
                <span className="rounded-full bg-amber-soft px-2.5 py-1 text-[11px] font-semibold text-amber-ink">Draft v1</span>
              </div>
              <ul className="mt-3 space-y-2.5">
                {LEDGER.map((c, i) => (
                  <li key={c.text} className="animate-rise rounded-xl border border-line bg-paper/60 p-3" style={{ animationDelay: `${300 + i * 260}ms` }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.type}</span>
                      <span className="animate-stamp" style={{ animationDelay: `${650 + i * 260}ms` }}>
                        <StatusChip status={c.status} />
                      </span>
                    </div>
                    <p className="mt-1 text-[14px] leading-snug text-ink">{c.text}</p>
                    <p className="mt-1 font-mono text-[11px] text-supported">{c.ref}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how" className="border-y border-line bg-card/70">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">How it works</p>
            <h2 className="font-display mt-2 text-3xl font-semibold text-ink">Five steps, each with a clear owner</h2>
            <ol className="relative mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <span className="animate-draw absolute left-6 right-6 top-6 hidden h-px bg-line-2 lg:block" aria-hidden />
              {STEPS.map((s, i) => (
                <li key={s.name} className="relative">
                  <span className="relative z-10 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-card text-ink shadow-[var(--shadow-sm)]">
                    <s.Icon className="h-5 w-5" strokeWidth={1.8} />
                  </span>
                  <p className="mt-4 text-xs font-semibold text-amber-ink">Step {i + 1}</p>
                  <p className="font-display text-xl font-semibold text-ink">{s.name}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="trust" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">Evidence, not guesswork</p>
              <h2 className="font-display mt-2 text-3xl font-semibold text-ink">Five statuses, set by rules</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                The language model only proposes claims and quotes. Deterministic code and a separate verifier decide how much each
                claim can be trusted, and the reason is always shown.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {(["verified", "supported", "inferred", "conflicting", "missing"] as Status[]).map((s) => <StatusChip key={s} status={s} size="md" />)}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="lift rounded-2xl border border-line bg-card p-5">
                  <p.Icon className="h-5 w-5 text-amber-ink" strokeWidth={1.8} />
                  <p className="mt-3 font-semibold text-ink">{p.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section id="features" className="border-t border-line bg-card/70">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">Built for real teams</p>
            <h2 className="font-display mt-2 max-w-2xl text-3xl font-semibold text-ink">Everything around the handover, not just the handover</h2>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="lift rounded-2xl border border-line bg-card p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-soft text-amber-ink"><f.Icon className="h-5 w-5" strokeWidth={1.8} /></span>
                  <p className="mt-4 font-semibold text-ink">{f.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">Security and privacy</p>
              <h2 className="font-display mt-2 text-3xl font-semibold text-ink">Designed for the parts of a project people shouldn&apos;t see</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                Handovers touch budgets, contracts and credentials. Baton treats every source as restricted until its access list
                says otherwise, and every rule below is enforced on the server and covered by automated tests.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SECURITY.map((t) => (
                <li key={t} className="flex items-start gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm text-ink-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-verified" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-8">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-strong px-6 py-12 text-center text-on-strong sm:px-12">
            <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-amber/25 blur-3xl" aria-hidden />
            <h2 className="font-display relative text-3xl font-semibold sm:text-4xl">See a full handover in two minutes</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-[15px] opacity-80">
              Open your own copy of the demo project, review the evidence as the reviewer, then read the result as the successor.
            </p>
            <div className="relative mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <TryDemoButton inverted />
              <ButtonLink href="/new" variant="secondary" size="lg">Use your own repo <ArrowRight className="h-4 w-4" /></ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-card/60">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-5 py-10 text-sm sm:grid-cols-4 sm:px-8">
          <div className="col-span-2">
            <Logo />
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted">
              Evidence-graded knowledge handovers for small software teams. The demo project and its people are fictional.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Product</p>
            <ul className="mt-3 space-y-2 text-ink-2">
              <li><a className="hover:text-ink" href="#how">How it works</a></li>
              <li><a className="hover:text-ink" href="#features">Features</a></li>
              <li><a className="hover:text-ink" href="#security">Security</a></li>
              <li><a className="hover:text-ink" href="/new">Use your repo</a></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Resources</p>
            <ul className="mt-3 space-y-2 text-ink-2">
              <li><a className="inline-flex items-center gap-1.5 hover:text-ink" href="https://github.com/theseriouscoder123/CodersPune" target="_blank" rel="noreferrer"><Github className="h-3.5 w-3.5" /> Source code</a></li>
              <li><a className="hover:text-ink" href="/api/docs" target="_blank" rel="noreferrer">API reference</a></li>
              <li><a className="hover:text-ink" href="/api/health" target="_blank" rel="noreferrer">Service status</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>© 2026 Baton · Built by Archit Dandavate with AI assistance (Claude Code) · Demo data is synthetic</span>
            <ApiStatus />
          </div>
        </div>
      </footer>
    </div>
  );
}

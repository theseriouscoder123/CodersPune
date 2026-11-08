import { ArrowRight, Eye, FileSearch, GitBranch, Handshake, Lock, Scale, ShieldCheck, UserCheck } from "lucide-react";

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

const PRINCIPLES = [
  { Icon: ShieldCheck, title: "Assumptions never pass as fact", text: "A claim is Supported only if its quote is found verbatim in the source and an independent check agrees. Anything else is labelled Inferred and kept away from the successor." },
  { Icon: Lock, title: "Access is enforced on the server", text: "A claim is shown only if every source it cites is readable by that person. Restricted text is never mixed into what others see." },
  { Icon: Eye, title: "A human approves every handover", text: "Nothing reaches the successor until a reviewer has read the evidence, resolved conflicts and approved a version." },
];

export default function Home() {
  return (
    <div className="paper-grain flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#how" className="rounded-lg px-3 py-2 text-ink-2 hover:bg-paper-2">How it works</a>
          <a href="#trust" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-paper-2 sm:block">Trust</a>
          <ThemeToggle />
          <ButtonLink href="/new" variant="secondary" size="sm" className="ml-1">Use your repo</ButtonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-2">
              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-amber" /> Knowledge handover for small software teams
            </p>
            <h1 className="font-display mt-5 text-[40px] font-semibold leading-[1.05] text-ink sm:text-[46px] lg:text-[56px]">
              When someone leaves,<br className="hidden lg:block" /> keep the <em className="font-normal italic text-amber-ink">reasoning</em>,<br className="hidden lg:block" /> not just the files.
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
            <ol className="relative mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
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
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
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
            <div className="grid gap-4 sm:grid-cols-3">
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
      </main>

      <footer className="border-t border-line bg-card/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>CodersInPune Hackathon · Round 2 · Team LoneWolf · Demo data is synthetic · Built with Claude Code</span>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}

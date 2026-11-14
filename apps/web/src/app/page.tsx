import { ArrowRight, Github } from "lucide-react";
import Image from "next/image";

import verifyDark from "../../public/verify-dark.png";
import verifyLight from "../../public/verify-light.png";
import { ApiStatus } from "@/components/ApiStatus";
import { Logo } from "@/components/Logo";
import { PassIcon, StatusIcon, STATUS_META } from "@/components/ledger/StatusChip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TryDemoButton } from "@/components/TryDemoButton";
import { ButtonLink } from "@/components/ui";
import type { Status } from "@/lib/api";

const STEPS = [
  { name: "Connect", text: "Bring in a repo, meeting notes and chat. Each source is tagged with who may read it. Secrets are stripped on the way in." },
  { name: "Reconstruct", text: "Decisions, owners, open work, risks and contacts become single claims, each tied to an exact quote." },
  { name: "Verify", text: "Every quote is matched against its source and checked by a separate model. Rules, not the AI, set the status." },
  { name: "Review & approve", text: "A reviewer confirms, fixes or rejects claims and previews exactly what the successor will see." },
  { name: "Handover", text: "The successor gets a continuation plan filtered to their access, with every gap marked." },
];

const STATUSES: { s: Status; rule: string; successor: string }[] = [
  { s: "verified", rule: "Quote found word for word, a separate check agrees, and a reviewer confirmed it.", successor: "Shown" },
  { s: "supported", rule: "Quote found word for word and a separate check agrees. No person has confirmed it yet.", successor: "Shown, marked unconfirmed" },
  { s: "inferred", rule: "No quote passed the checks. It may be true, but nothing in the sources says so.", successor: "Hidden unless a reviewer promotes it" },
  { s: "conflicting", rule: "Another claim gives a different value for the same subject.", successor: "Shown as a risk until resolved" },
  { s: "missing", rule: "The successor will need this, but no source covers it.", successor: "Listed as unresolved" },
];

const FEATURES = [
  { title: "Ask the handover", text: "Successors ask in plain English and get answers built only from approved items they may see, with numbered citations." },
  { title: "Private links per person", text: "Lock identities so everyone sees the project only as themselves. Revoking a link signs that person out." },
  { title: "Re-runs keep your review work", text: "Refresh reads only what changed. If a source is edited, evidence follows its quote, or the claim is flagged for review." },
  { title: "Email, Slack and Discord", text: "Tell the successor when a version is approved and send open questions to the leaver. Messages never include claim text." },
  { title: "Your data stays yours", text: "Export a whole workspace as JSON, print the handover, or delete everything with one confirmed action." },
  { title: "Works with what you have", text: "Public or private GitHub repos, Markdown, PDF and Word notes, live Slack channels, and Slack or Discord exports." },
];

const SECURITY = [
  "Secrets and tokens are removed before anything is stored or sent to a model",
  "Access is checked on the server at every read, never only in the browser",
  "A claim is visible only if every source it cites is visible to you",
  "Private-repo and Slack tokens are used once and never stored",
  "Phone numbers and emails are masked for everyone but the reviewer",
  "Every review decision is recorded in an append-only activity log",
];

const H2 = "text-[24px] font-semibold leading-8 tracking-[-0.02em] text-fg";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col overflow-x-clip bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1160px] items-center justify-between px-4 sm:px-8">
          <Logo />
          <nav className="flex items-center gap-0.5 text-[13px]">
            <a href="#how" className="hidden h-8 items-center rounded-md px-2.5 text-fg-2 hover:bg-hover hover:text-fg sm:inline-flex">How it works</a>
            <a href="#trust" className="hidden h-8 items-center rounded-md px-2.5 text-fg-2 hover:bg-hover hover:text-fg sm:inline-flex">Statuses</a>
            <a href="#security" className="hidden h-8 items-center rounded-md px-2.5 text-fg-2 hover:bg-hover hover:text-fg md:inline-flex">Security</a>
            <ThemeToggle />
            <ButtonLink href="/new" variant="secondary" size="sm" className="ml-1.5 whitespace-nowrap">Use your repo</ButtonLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-[1160px] px-4 pb-14 pt-14 sm:px-8 sm:pt-20">
          <div className="max-w-[760px]">
            <p className="text-[13px] font-medium text-accent-ink">Knowledge handover for small software teams</p>
            <h1 className="mt-3 text-[36px] font-[650] leading-[1.1] tracking-[-0.025em] text-fg [text-wrap:balance] sm:text-[48px]">
              When someone leaves, keep the reasoning, not just the files.
            </h1>
            <p className="mt-5 max-w-[620px] text-[16px] leading-[26px] text-fg-2">
              Baton rebuilds a project&apos;s decisions, owners, risks and open work from its repo, notes and chat. Every statement
              is linked to a source and graded by its evidence, and nothing reaches the successor until a person approves it.
            </p>
            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-start">
              <TryDemoButton />
              <ButtonLink href="/new" variant="secondary" size="lg" data-testid="start-repo">
                Start with a public GitHub repo <ArrowRight />
              </ButtonLink>
            </div>
            <p className="mt-3 text-[12.5px] text-fg-3">
              The demo is a fictional student-club project, opened in your own copy so nothing you do affects other visitors. No sign-up.
            </p>
          </div>

          <figure className="mt-12 overflow-hidden rounded-[10px] border border-line bg-bg-side shadow-[var(--pop)]">
            <Image src={verifyLight} alt="The Verify screen: claims grouped by status on the left; on the right a conflicting claim with its rule checks and the two quotes that disagree, side by side." priority sizes="(min-width: 1160px) 1096px, 100vw" className="only-light h-auto w-full" />
            <Image src={verifyDark} alt="" aria-hidden sizes="(min-width: 1160px) 1096px, 100vw" className="only-dark h-auto w-full" />
          </figure>
          <p className="mt-3 text-center text-[12.5px] text-fg-3">Verify: every claim shows the exact quote it rests on, and the rules that set its status.</p>
        </section>

        <section id="how" className="border-t border-line">
          <div className="mx-auto max-w-[1160px] px-4 py-16 sm:px-8">
            <h2 className={H2}>How it works</h2>
            <p className="mt-1 text-[14px] text-fg-3">Five steps. The AI proposes; rules grade; a person decides.</p>
            <ol className="mt-8 grid grid-cols-1 overflow-hidden rounded-lg border border-line sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-line max-lg:divide-y max-lg:divide-line">
              {STEPS.map((s, i) => (
                <li key={s.name} className="px-4 py-4">
                  <p className="font-mono text-[12px] text-fg-3">{String(i + 1).padStart(2, "0")}</p>
                  <p className="mt-1 text-[14px] font-semibold text-fg">{s.name}</p>
                  <p className="mt-1 text-[13px] leading-5 text-fg-3">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="trust" className="border-t border-line">
          <div className="mx-auto max-w-[1160px] px-4 py-16 sm:px-8">
            <h2 className={H2}>Five statuses, set by rules</h2>
            <p className="mt-1 max-w-[640px] text-[14px] leading-[22px] text-fg-3">
              The language model only proposes claims and quotes. Deterministic code and a separate verifier decide how much each claim can be trusted, and the reason is always shown.
            </p>
            <div className="mt-8 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-line bg-bg-sunk text-[12px] text-fg-3">
                  <tr><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">The rule</th><th className="px-4 py-2 font-medium">What the successor sees</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {STATUSES.map(({ s, rule, successor }) => (
                    <tr key={s}>
                      <td className="whitespace-nowrap px-4 py-3"><span className="inline-flex items-center gap-2 font-medium text-fg"><StatusIcon status={s} size={14} /> {STATUS_META[s].label}</span></td>
                      <td className="px-4 py-3 text-fg-2">{rule}</td>
                      <td className="px-4 py-3 text-fg-3">{successor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-line">
          <div className="mx-auto max-w-[1160px] px-4 py-16 sm:px-8">
            <h2 className={H2}>Everything around the handover</h2>
            <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title}>
                  <p className="text-[14px] font-semibold text-fg">{f.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-fg-3">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="border-t border-line">
          <div className="mx-auto grid max-w-[1160px] grid-cols-1 items-start gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <h2 className={H2}>Built for the parts of a project people shouldn&apos;t see</h2>
              <p className="mt-2 text-[14px] leading-[22px] text-fg-3">
                Handovers touch budgets, contracts and credentials. Baton treats every source as restricted until its access list
                says otherwise, and every rule here is enforced on the server and covered by automated tests.
              </p>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {SECURITY.map((t) => (
                <li key={t} className="flex items-start gap-2.5 px-4 py-2.5 text-[13px] text-fg-2">
                  <span className="mt-[3px]"><PassIcon size={13} /></span> {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto flex max-w-[1160px] flex-col items-start justify-between gap-6 px-4 py-14 sm:px-8 md:flex-row md:items-center">
            <div>
              <h2 className={H2}>See a full handover in two minutes</h2>
              <p className="mt-1 max-w-[560px] text-[14px] text-fg-3">Open your own copy of the demo, review the evidence as the reviewer, then read the result as the successor.</p>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
              <TryDemoButton />
              <ButtonLink href="/new" variant="secondary" size="lg">Use your own repo <ArrowRight /></ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-bg-side">
        <div className="mx-auto grid w-full max-w-[1160px] grid-cols-2 gap-8 px-4 py-10 text-[13px] sm:grid-cols-4 sm:px-8">
          <div className="col-span-2">
            <Logo small />
            <p className="mt-3 max-w-xs text-[12.5px] leading-[18px] text-fg-3">
              Evidence-graded knowledge handovers for small software teams. The demo project and its people are fictional.
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-fg-3">Product</p>
            <ul className="mt-2.5 space-y-1.5 text-fg-2">
              <li><a className="hover:text-fg" href="#how">How it works</a></li>
              <li><a className="hover:text-fg" href="#features">Features</a></li>
              <li><a className="hover:text-fg" href="#security">Security</a></li>
              <li><a className="hover:text-fg" href="/new">Use your repo</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-medium text-fg-3">Resources</p>
            <ul className="mt-2.5 space-y-1.5 text-fg-2">
              <li><a className="inline-flex items-center gap-1.5 hover:text-fg" href="https://github.com/theseriouscoder123/CodersPune" target="_blank" rel="noreferrer"><Github className="h-3.5 w-3.5" /> Source code</a></li>
              <li><a className="hover:text-fg" href="/api/docs" target="_blank" rel="noreferrer">API reference</a></li>
              <li><a className="hover:text-fg" href="/api/health" target="_blank" rel="noreferrer">Service status</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-2 px-4 py-4 text-[12px] text-fg-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>© 2026 Baton · Built by Archit Dandavate with AI assistance (Claude Code) · Demo data is synthetic</span>
            <ApiStatus />
          </div>
        </div>
      </footer>
    </div>
  );
}

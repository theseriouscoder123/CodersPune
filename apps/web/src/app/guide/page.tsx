import type { Metadata } from "next";

import { Logo } from "@/components/Logo";
import { StatusIcon, STATUS_META } from "@/components/ledger/StatusChip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ButtonLink } from "@/components/ui";
import type { Status } from "@/lib/api";

export const metadata: Metadata = {
  title: "Guide · Baton",
  description: "How Baton reconstructs, verifies and hands over a project's knowledge: the workflow, statuses, access rules and limits.",
};

const TOC = [
  ["overview", "Overview"],
  ["workflow", "The workflow"],
  ["statuses", "Statuses"],
  ["access", "People and access"],
  ["history", "Conflicts and history"],
  ["successor", "For the successor"],
  ["leaver", "Questions for the leaver"],
  ["own-repo", "Using your own project"],
  ["shortcuts", "Keyboard shortcuts"],
  ["limits", "Limits"],
] as const;

const STATUSES: { s: Status; rule: string }[] = [
  { s: "verified", rule: "The quote is found word for word in its source, a separate check agrees it supports the claim, and a reviewer confirmed it." },
  { s: "supported", rule: "Quote found and the separate check agrees. Nobody has confirmed it yet; the successor sees it marked that way." },
  { s: "inferred", rule: "No evidence passed both checks. Never shown to the successor as fact; a reviewer can promote it with a note, and it is then labelled as reviewer-confirmed without source evidence." },
  { s: "conflicting", rule: "Another current claim gives a different value for the same subject. Shared as a risk until a reviewer resolves it." },
  { s: "missing", rule: "Knowledge the sources should contain (from repository signals such as open PRs or config) but don't. Listed as unresolved and turned into questions for the leaver." },
];

const H2 = "scroll-mt-20 text-[20px] font-semibold tracking-[-0.015em] text-fg";
const P = "mt-3 text-[14px] leading-[23px] text-fg-2";
const LI = "text-[14px] leading-[23px] text-fg-2";

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-[22px] min-w-[22px] place-items-center rounded border border-line-2 bg-bg-sunk px-1.5 font-mono text-[12px] text-fg-2">{children}</kbd>;
}

export default function GuidePage() {
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-[1160px] items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3"><Logo /><span className="text-[13px] text-fg-3">Guide</span></div>
          <nav className="flex items-center gap-1">
            <ThemeToggle />
            <ButtonLink href="/" variant="secondary" size="sm">Back to Baton</ButtonLink>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1160px] grid-cols-1 gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-0.5 text-[13px]" aria-label="Guide contents">
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block rounded-md px-2 py-1 text-fg-3 hover:bg-hover hover:text-fg">{label}</a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 max-w-[720px]">
          <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.02em] text-fg">Baton guide</h1>
          <p className="mt-2 text-[15px] leading-[24px] text-fg-2">
            Reference for reviewers, leavers and successors. The product works without reading this; it explains the rules behind what you see.
          </p>

          <section id="overview" className="mt-12">
            <h2 className={H2}>Overview</h2>
            <p className={P}>
              Baton rebuilds what a departing teammate knows (decisions and why, owners, open work, risks, dependencies and contacts) from a
              repository, meeting notes and chat. Each statement is a <b className="font-medium text-fg">claim</b> tied to an exact quote. A
              language model proposes claims and quotes; deterministic rules and a separate verifier decide how far each can be trusted. A person
              approves what the successor receives, and the successor sees only what their own access allows.
            </p>
          </section>

          <section id="workflow" className="mt-12">
            <h2 className={H2}>The workflow</h2>
            <ol className="mt-4 space-y-4">
              {[
                ["Connect", "Add sources and set who may read each one. API keys, tokens and passwords are removed before anything is stored or sent to a model."],
                ["Reconstruct", "Sources are split into passages, batched by identical access (restricted and public text are never mixed in one request), and turned into claims. The ledger shows counts by status and type, and a decision timeline."],
                ["Verify", "Every quote is matched against its passage (normalised fuzzy match of at least 90). Quotes that pass go to a separate verifier that sees only the claim and the quoted span. The status follows from those results."],
                ["Review & approve", "The reviewer confirms, edits, rejects or promotes claims, resolves conflicts, previews exactly what the successor will see, and approves a version. Nothing reaches the successor before an approval."],
                ["Handover", "The successor reads the latest approved version as a continuation plan: start here, owners, key decisions, risks, dependencies and unresolved items."],
              ].map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
                  <span className="pt-[2px] font-mono text-[12px] text-fg-3">{String(i + 1).padStart(2, "0")}</span>
                  <div><p className="text-[14px] font-semibold text-fg">{t}</p><p className={LI}>{d}</p></div>
                </li>
              ))}
            </ol>
          </section>

          <section id="statuses" className="mt-12">
            <h2 className={H2}>Statuses</h2>
            <p className={P}>Statuses come from fixed rules, never from the model. Each claim shows the checks that set its status.</p>
            <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {STATUSES.map(({ s, rule }) => (
                <div key={s} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                  <span className="inline-flex items-center gap-2 text-[13px] font-medium text-fg"><StatusIcon status={s} size={14} /> {STATUS_META[s].label}</span>
                  <span className="text-[13px] leading-[21px] text-fg-2">{rule}</span>
                </div>
              ))}
            </div>
            <p className={P}>Rejected claims are never shared. Edited claims need confirmation of the new wording before they count as verified.</p>
          </section>

          <section id="access" className="mt-12">
            <h2 className={H2}>People and access</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li className={LI}><b className="font-medium text-fg">Reviewer</b>: reads everything, decides statuses by reviewing, approves versions. Also the workspace admin.</li>
              <li className={LI}><b className="font-medium text-fg">Leaver</b>: the person whose knowledge is reconstructed; can read the ledger and answer gap questions.</li>
              <li className={LI}><b className="font-medium text-fg">Successor</b>: sees only the latest approved version, filtered to their access.</li>
              <li className={LI}><b className="font-medium text-fg">Member</b>: anyone else on the team.</li>
            </ul>
            <p className={P}>
              A claim is visible to someone only if <b className="font-medium text-fg">every</b> source it cites is visible to them. This is enforced
              on the server for every request, not in the page. Items the successor can&apos;t see are withheld; the reviewer can show them as
              &ldquo;Restricted item&rdquo; stubs that reveal no text, type or source, or rewrite them from sources the successor can read.
              Personal emails and phone numbers are masked for everyone except reviewers.
            </p>
          </section>

          <section id="history" className="mt-12">
            <h2 className={H2}>Conflicts and history</h2>
            <p className={P}>Claims about the same subject are compared by rules:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li className={LI}><b className="font-medium text-fg">Reversal</b>: a later claim replaces an earlier one (&ldquo;replaced Supabase with Firebase&rdquo;, or &ldquo;updated to Node 24&rdquo; on a version). The earlier one is <i>superseded</i> and kept as history.</li>
              <li className={LI}><b className="font-medium text-fg">Contradiction</b>: different values with nothing saying one replaced the other. A reviewer picks one, or keeps both as an open risk.</li>
              <li className={LI}><b className="font-medium text-fg">Overtaken work</b>: open work that a later update, a decision, or its own record shows as done or parked is labelled <i>Updated later</i>, <i>Parked</i> or <i>Probably done</i> and moved out of &ldquo;Start here&rdquo;. A reviewer can mark it as still open.</li>
            </ul>
          </section>

          <section id="successor" className="mt-12">
            <h2 className={H2}>For the successor</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li className={LI}>Tick an item once you&apos;ve read it, mark it <i>Not mine</i>, or ask a question about it; the reviewer sees open questions until they are answered.</li>
              <li className={LI}><i>Ask the handover</i> answers in plain English from approved items you may see, with numbered citations. If the handover doesn&apos;t cover a question, it says so.</li>
              <li className={LI}><i>Your first week</i> arranges the approved items by when to pick them up, and ticks them off as you acknowledge them.</li>
              <li className={LI}>When a new version is approved, items that changed since you acknowledged them are flagged.</li>
            </ul>
          </section>

          <section id="leaver" className="mt-12">
            <h2 className={H2}>Questions for the leaver</h2>
            <p className={P}>
              Missing and conflicting claims become targeted questions. They can be copied as Markdown or a GitHub issue, or answered in a
              <i> gap interview</i>: each answer is stored as a cited &ldquo;leaver testimony&rdquo; source and goes through the same quote and
              verifier checks as any other source. <i>Before the leaver goes</i> lists what to collect while they are still around.
            </p>
          </section>

          <section id="own-repo" className="mt-12">
            <h2 className={H2}>Using your own project</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li className={LI}><b className="font-medium text-fg">Repository</b>: any public GitHub repository, or a private one with a read-only token that is used once and never stored. Baton reads the latest 300 commits, 60 PRs, 60 issues and up to 30 docs and config files. Bot activity and dependency bumps are skipped.</li>
              <li className={LI}><b className="font-medium text-fg">Notes</b>: .md, .txt, .pdf (with a text layer) or .docx; up to 10 files of 2 MB each.</li>
              <li className={LI}><b className="font-medium text-fg">Chat</b>: a Slack export (JSON array of messages) or a Discord export from DiscordChatExporter. Each channel becomes its own source.</li>
              <li className={LI}>Use each person&apos;s GitHub username so commits, PRs and issues are matched to them. Exactly one reviewer, one leaver and one successor.</li>
              <li className={LI}>A run usually takes 5 to 10 minutes for a small repository. Finished steps are kept, so a stopped or cancelled run resumes where it left off. Re-runs read only what changed and keep review work.</li>
            </ul>
          </section>

          <section id="shortcuts" className="mt-12">
            <h2 className={H2}>Keyboard shortcuts</h2>
            <p className={P}>On the Verify screen:</p>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {[["j", "Next claim"], ["k", "Previous claim"], ["c", "Confirm"], ["r", "Reject"], ["e", "Edit"], ["x", "Select"], ["/", "Filter"], ["?", "All shortcuts"]].map(([k, d]) => (
                <span key={k} className="flex items-center gap-2 text-[13px] text-fg-2"><Kbd>{k}</Kbd>{d}</span>
              ))}
            </div>
            <p className={P}>Anywhere in a workspace, <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> searches claims and sources you can see.</p>
          </section>

          <section id="limits" className="mt-12 mb-8">
            <h2 className={H2}>Limits</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li className={LI}>Up to 3 new workspaces per browser and 6 per network each day. The demo workspace is computed in advance and needs no AI.</li>
              <li className={LI}>Runs use free AI tiers. If every key is busy or out of quota, the run stops with a clear message and can be resumed later; claims are never graded without both checks.</li>
              <li className={LI}>Very old history may be skipped to stay within the AI budget; the run log says how much.</li>
              <li className={LI}>Workspaces you create belong to your browser. Share them with private links from Team &amp; access.</li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}

import Link from "next/link";

import { ApiStatus } from "@/components/ApiStatus";
import { Logo } from "@/components/Logo";
import { TryDemoButton } from "@/components/TryDemoButton";

const STEPS = [
  { n: "01", name: "Connect", text: "Bring in a GitHub repo, meeting notes and a chat export. Each source is tagged with who may read it." },
  { n: "02", name: "Reconstruct", text: "Baton extracts decisions, owners, open work, risks and contacts as single claims, each with a quoted source." },
  { n: "03", name: "Verify", text: "Every quote is checked against its source. Rules, not the AI, decide whether a claim is supported, inferred, conflicting or missing." },
  { n: "04", name: "Review", text: "A reviewer confirms, fixes or rejects claims, previews exactly what the successor will see, and approves." },
  { n: "05", name: "Handover", text: "The successor gets a continuation plan filtered to what they may access, with unresolved items clearly marked." },
];

const STATUSES = [
  { name: "Verified", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  { name: "Supported", cls: "bg-blue-50 text-blue-800 ring-blue-200" },
  { name: "Inferred", cls: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
  { name: "Conflicting", cls: "bg-orange-50 text-orange-800 ring-orange-200" },
  { name: "Missing", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <span className="rounded-full bg-panel px-3 py-1 text-xs font-medium text-muted ring-1 ring-line">
          Round 2 build
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="py-12 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-widest text-amber">Knowledge handover</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-navy sm:text-5xl">
            When someone leaves a project, keep the reasoning, not just the files.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Baton links every statement to its source and flags every gap. Nothing reaches the successor until a person
            has reviewed and approved it.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <TryDemoButton />
            <Link href="/new" className="rounded-lg border border-line px-5 py-3 text-center text-sm font-semibold text-navy hover:bg-panel" data-testid="start-repo">
              Start with a public GitHub repo
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted">The demo is a fictional student-club project, opened in your own copy so nothing you do affects other visitors.</p>
        </section>

        <section aria-labelledby="how" className="pb-16">
          <h2 id="how" className="sr-only">
            How it works
          </h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl bg-navy p-5 text-white">
                <p className="text-xs font-semibold tracking-widest text-amber">{s.n}</p>
                <p className="mt-1 text-lg font-semibold">{s.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/75">{s.text}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-xl border border-line bg-panel p-5">
            <p className="text-sm font-semibold text-navy">Every claim gets one of five statuses, assigned by rules</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <span key={s.name} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${s.cls}`}>
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:justify-between sm:px-6">
          <span>CodersInPune Hackathon · Round 2 · Team LoneWolf · demo data is synthetic</span>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}

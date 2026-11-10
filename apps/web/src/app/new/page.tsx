"use client";

import { ArrowLeft, ArrowRight, GitBranch, Lock, MessageSquare, Plus, ShieldCheck, Trash2, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, Button, Card } from "@/components/ui";

type Role = "reviewer" | "leaver" | "successor" | "member";
type Person = { name: string; handle: string; role: Role };
type Access = { mode: "all" | "some"; handles: string[] };

const ROLE_HELP: Record<Role, string> = {
  reviewer: "checks the evidence and approves (also admin)",
  leaver: "the person leaving; their work is reconstructed",
  successor: "takes over; sees only the approved, permitted handover",
  member: "anyone else on the team",
};

const INPUT = "h-10 w-full rounded-xl border border-line bg-card px-3 text-sm outline-none transition focus:border-ink/30 focus:ring-2 focus:ring-amber/30";
const FILE_ZONE = "mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-2 bg-paper/60 px-4 py-3 text-sm text-ink-2 transition hover:border-ink/30 hover:bg-card";

function AccessPicker({ label, value, onChange, people }: { label: string; value: Access; onChange: (a: Access) => void; people: Person[] }) {
  const named = people.filter((p) => p.handle.trim() && p.role !== "reviewer");
  return (
    <fieldset className="animate-fade mt-3 rounded-xl border border-line bg-paper/60 p-3 text-sm">
      <legend className="sr-only">{label}</legend>
      <span className="text-xs font-semibold text-muted">Who may read this source?</span>
      <div className="mt-1.5 flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5">
          <input className="accent-[var(--ink)]" type="radio" checked={value.mode === "all"} onChange={() => onChange({ mode: "all", handles: [] })} /> All members
        </label>
        <label className="flex items-center gap-1.5">
          <input className="accent-[var(--ink)]" type="radio" checked={value.mode === "some"} onChange={() => onChange({ mode: "some", handles: value.handles })} /> Only selected people
        </label>
      </div>
      {value.mode === "some" && (
        <div className="mt-2 flex flex-wrap gap-3">
          {named.map((p) => (
            <label key={p.handle} className="flex items-center gap-1.5">
              <input className="accent-[var(--ink)]" type="checkbox" checked={value.handles.includes(p.handle.trim().toLowerCase())}
                onChange={(e) => {
                  const h = p.handle.trim().toLowerCase();
                  onChange({ mode: "some", handles: e.target.checked ? [...value.handles, h] : value.handles.filter((x) => x !== h) });
                }} />
              {p.name || p.handle} <span className="text-xs text-muted">({p.role})</span>
            </label>
          ))}
          <span className="text-xs text-muted">The reviewer can always read every source.</span>
        </div>
      )}
    </fieldset>
  );
}

function SectionTitle({ n, title, icon }: { n: number; title: string; icon: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-strong text-xs font-bold text-on-strong">{n}</span>
      <span className="font-display text-lg font-semibold text-ink">{title}</span>
      <span className="text-muted">{icon}</span>
    </h2>
  );
}

const accessValue = (a: Access) => (a.mode === "all" ? "all" : JSON.stringify(a.handles));

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [people, setPeople] = useState<Person[]>([
    { name: "", handle: "", role: "reviewer" },
    { name: "", handle: "", role: "leaver" },
    { name: "", handle: "", role: "successor" },
  ]);
  const [notes, setNotes] = useState<File[]>([]);
  const [chat, setChat] = useState<File | null>(null);
  const [repoAccess, setRepoAccess] = useState<Access>({ mode: "all", handles: [] });
  const [notesAccess, setNotesAccess] = useState<Access>({ mode: "all", handles: [] });
  const [chatAccess, setChatAccess] = useState<Access>({ mode: "all", handles: [] });
  const [authorised, setAuthorised] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPerson = (i: number, patch: Partial<Person>) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const roleCount = (r: Role) => people.filter((p) => p.role === r).length;
  const problems = [
    !name.trim() && "Give the project a name.",
    !repo.trim() && notes.length === 0 && !chat && "Add at least one source.",
    people.some((p) => !p.name.trim() || !p.handle.trim()) && "Every member needs a name and a handle.",
    (["reviewer", "leaver", "successor"] as Role[]).some((r) => roleCount(r) !== 1) && "Pick exactly one reviewer, one leaver and one successor.",
    !authorised && "Confirm you're authorised to use these sources.",
  ].filter(Boolean) as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("members", JSON.stringify(people.map((p) => ({ name: p.name.trim(), handle: p.handle.trim(), roles: [p.role] }))));
    if (repo.trim()) fd.set("repo_url", repo.trim());
    if (repo.trim() && ghToken.trim()) fd.set("github_token", ghToken.trim());
    fd.set("repo_access", accessValue(repoAccess));
    fd.set("notes_access", accessValue(notesAccess));
    fd.set("chat_access", accessValue(chatAccess));
    fd.set("confirm_authorised", String(authorised));
    notes.forEach((f) => fd.append("notes", f));
    if (chat) fd.set("chat", chat);
    try {
      const res = await fetch("/api/workspaces", { method: "POST", body: fd, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status})`);
      router.push(`/w/${body.workspace_id}/runs/${body.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="paper-grain flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link href="/" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-paper-2"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-20 sm:px-6">
        <div className="animate-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">New workspace</p>
          <h1 className="font-display mt-1 text-[34px] font-semibold leading-tight text-ink">Start a handover from your own project</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            Connect a <b>public</b> GitHub repository and, optionally, meeting notes and a Slack-style chat export. Baton reconstructs a ledger in
            a few minutes. Only use data you&apos;re allowed to share. For a quick look, the{" "}
            <Link href="/" className="font-semibold text-ink underline decoration-amber decoration-2 underline-offset-2">demo</Link> needs no setup.
          </p>
        </div>

        <form onSubmit={submit} className="stagger mt-8 space-y-5">
          <Card className="p-5 sm:p-6">
            <label className="text-sm font-semibold text-ink" htmlFor="name">Project name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT} mt-1.5`} placeholder="e.g. Robotics club scoring app" maxLength={80} />
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle n={1} title="People" icon={<Users className="h-4 w-4" />} />
            <p className="mt-1 text-sm text-muted">Use each person&apos;s <b className="text-ink-2">GitHub username</b> so Baton can match their commits, PRs and issues.</p>
            <div className="mt-4 space-y-2">
              {people.map((p, i) => (
                <div key={i} className="animate-fade grid grid-cols-1 gap-2 rounded-xl bg-paper/60 p-2 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-center sm:bg-transparent sm:p-0">
                  <input value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} placeholder="Name" className={INPUT} aria-label="Name" />
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">@</span>
                    <input value={p.handle} onChange={(e) => setPerson(i, { handle: e.target.value })} placeholder="github-username" className={`${INPUT} pl-7`} aria-label="GitHub username" />
                  </div>
                  <select value={p.role} onChange={(e) => setPerson(i, { role: e.target.value as Role })} className={`${INPUT} capitalize`} title={ROLE_HELP[p.role]} aria-label="Role">
                    {(Object.keys(ROLE_HELP) as Role[]).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="button" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))} disabled={people.length <= 2}
                    className="grid h-10 w-10 place-items-center justify-self-end rounded-xl text-muted transition hover:bg-missing-soft hover:text-missing disabled:opacity-30" aria-label="Remove member">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setPeople((ps) => [...ps, { name: "", handle: "", role: "member" }])} disabled={people.length >= 12}>
              <Plus className="h-4 w-4" /> Add member
            </Button>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                <div key={r} className={`rounded-xl px-3 py-2 text-xs ring-1 ring-line ${roleCount(r) === 1 || r === "member" ? "bg-card" : "bg-amber-soft/70"}`}>
                  <b className="capitalize text-ink">{r}</b> <span className="text-muted">· {ROLE_HELP[r]}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle n={2} title="Sources" icon={<GitBranch className="h-4 w-4" />} />
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-semibold text-ink" htmlFor="repo">Public GitHub repository</label>
                <div className="relative mt-1.5">
                  <GitBranch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} className={`${INPUT} pl-9`} placeholder="https://github.com/owner/repo" />
                </div>
                <p className="mt-1.5 text-xs text-muted">Reads the latest 300 commits, 60 PRs, 60 issues and up to 30 docs/config files. Each run reads the most useful recent history first; very old activity may be left out, and the run log says how much.</p>
                {repo.trim() && (
                  <details className="group mt-3 rounded-xl border border-line bg-paper/60 px-3 py-2 text-sm">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-2"><Lock className="h-3.5 w-3.5" /> Private repository? Add a read-only token</summary>
                    <input type="password" autoComplete="off" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="github_pat_…"
                      className={`${INPUT} mt-2 font-mono`} aria-label="GitHub read-only token" />
                    <p className="mt-1.5 text-xs text-muted">
                      Use a fine-grained token with <b>read-only</b> access to this one repository. It&apos;s used once to read the repo while the workspace is
                      created and is <b>never stored or logged</b>. Private repos can&apos;t be auto-refreshed later for the same reason.
                    </p>
                  </details>
                )}
                {repo.trim() && <AccessPicker label="Repository access" value={repoAccess} onChange={setRepoAccess} people={people} />}
              </div>
              <div className="border-t border-line pt-4">
                <span className="text-sm font-semibold text-ink">Meeting notes or docs</span>
                <label className={FILE_ZONE}>
                  <Upload className="h-4 w-4 shrink-0 text-muted" />
                  <span className="flex-1 truncate">{notes.length ? `${notes.length} file${notes.length > 1 ? "s" : ""}: ${notes.map((f) => f.name).join(", ")}` : "Choose .md, .txt, .pdf or Word .docx files (up to 10, 2 MB each)"}</span>
                  <input id="notes" type="file" multiple accept=".md,.markdown,.txt,.pdf,.docx" onChange={(e) => setNotes(Array.from(e.target.files ?? []))} className="sr-only" />
                </label>
                {notes.length > 0 && <AccessPicker label="Notes access" value={notesAccess} onChange={setNotesAccess} people={people} />}
              </div>
              <div className="border-t border-line pt-4">
                <span className="text-sm font-semibold text-ink">Chat export</span>
                <label className={FILE_ZONE}>
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted" />
                  <span className="flex-1 truncate">{chat ? chat.name : "Choose a Slack or Discord JSON export"}</span>
                  <input id="chat" type="file" accept=".json" onChange={(e) => setChat(e.target.files?.[0] ?? null)} className="sr-only" />
                </label>
                <p className="mt-1.5 text-xs text-muted">
                  A JSON array of messages with <code className="font-mono">ts</code>, <code className="font-mono">text</code>, <code className="font-mono">user</code> and optional{" "}
                  <code className="font-mono">thread_ts</code>/<code className="font-mono">channel</code>, or a Discord export from DiscordChatExporter (JSON). Each channel becomes its own source.
                </p>
                {chat && <AccessPicker label="Chat access" value={chatAccess} onChange={setChatAccess} people={people} />}
              </div>
            </div>
            <p className="mt-5 flex items-center gap-2 rounded-xl bg-supported-soft px-3 py-2 text-xs text-supported">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> API keys, tokens and passwords are removed before anything is stored or sent to the AI.
            </p>
          </Card>

          <Card className="p-5">
            <label className="flex items-start gap-3 text-sm text-ink-2">
              <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--ink)]" />
              <span>I&apos;m authorised to use these sources, and they contain no confidential workplace data I don&apos;t have permission to share.</span>
            </label>
          </Card>

          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" size="lg" loading={busy} data-testid="create-workspace">
              {busy ? "Creating…" : <>Create workspace and reconstruct <ArrowRight className="h-4 w-4" /></>}
            </Button>
            <span className="text-xs text-muted">Usually 5–10 minutes for a small repository · up to 3 new workspaces per day</span>
          </div>
        </form>
      </main>
    </div>
  );
}

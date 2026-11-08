"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/Logo";

type Role = "reviewer" | "leaver" | "successor" | "member";
type Person = { name: string; handle: string; role: Role };
type Access = { mode: "all" | "some"; handles: string[] };

const ROLE_HELP: Record<Role, string> = {
  reviewer: "checks the evidence and approves (also admin)",
  leaver: "the person leaving; their work is reconstructed",
  successor: "takes over; sees only the approved, permitted handover",
  member: "anyone else on the team",
};

function AccessPicker({ label, value, onChange, people }: { label: string; value: Access; onChange: (a: Access) => void; people: Person[] }) {
  const named = people.filter((p) => p.handle.trim() && p.role !== "reviewer");
  return (
    <fieldset className="mt-2 rounded-lg bg-panel p-3 text-sm">
      <legend className="sr-only">{label}</legend>
      <span className="text-xs font-semibold text-muted">Who may read this source?</span>
      <div className="mt-1 flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={value.mode === "all"} onChange={() => onChange({ mode: "all", handles: [] })} /> All members
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={value.mode === "some"} onChange={() => onChange({ mode: "some", handles: value.handles })} /> Only selected people
        </label>
      </div>
      {value.mode === "some" && (
        <div className="mt-2 flex flex-wrap gap-3">
          {named.map((p) => (
            <label key={p.handle} className="flex items-center gap-1.5">
              <input type="checkbox" checked={value.handles.includes(p.handle.trim().toLowerCase())}
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

const accessValue = (a: Access) => (a.mode === "all" ? "all" : JSON.stringify(a.handles));

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
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

  const input = "w-full rounded-lg border border-line px-3 py-2 text-sm";
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <Link href="/" className="text-sm text-muted hover:text-navy">← Back</Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-navy">Start a handover from your own project</h1>
        <p className="mt-2 text-muted">
          Connect a <b>public</b> GitHub repository, and optionally add meeting notes and a Slack-style chat export. Baton reconstructs a
          ledger in a few minutes. Only use data you&apos;re allowed to share; for a quick look, the{" "}
          <Link href="/" className="font-semibold text-navy underline">demo</Link> needs no setup.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-8">
          <section>
            <label className="text-sm font-semibold text-navy" htmlFor="name">Project name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} placeholder="e.g. Robotics club scoring app" maxLength={80} />
          </section>

          <section>
            <h2 className="text-lg font-semibold text-navy">1 · People</h2>
            <p className="text-sm text-muted">Use each person&apos;s <b>GitHub username</b> as the handle, so Baton can match their commits, PRs and issues.</p>
            <div className="mt-3 space-y-2">
              {people.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <input value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} placeholder="Name" className={input} aria-label="Name" />
                  <input value={p.handle} onChange={(e) => setPerson(i, { handle: e.target.value })} placeholder="GitHub username" className={input} aria-label="GitHub username" />
                  <select value={p.role} onChange={(e) => setPerson(i, { role: e.target.value as Role })} className="rounded-lg border border-line px-2 py-2 text-sm" title={ROLE_HELP[p.role]}>
                    {(Object.keys(ROLE_HELP) as Role[]).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="button" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))} disabled={people.length <= 2}
                    className="px-2 text-muted hover:text-rose-700 disabled:opacity-30" aria-label="Remove member">✕</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setPeople((ps) => [...ps, { name: "", handle: "", role: "member" }])} disabled={people.length >= 12}
              className="mt-2 text-sm font-semibold text-navy hover:underline">+ Add member</button>
            <ul className="mt-2 text-xs text-muted">{(Object.keys(ROLE_HELP) as Role[]).map((r) => <li key={r}><b>{r}</b>: {ROLE_HELP[r]}</li>)}</ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-navy">2 · Sources</h2>
            <div className="mt-3 rounded-xl border border-line p-4">
              <label className="text-sm font-semibold text-navy" htmlFor="repo">Public GitHub repository</label>
              <input id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} className={`${input} mt-1`} placeholder="https://github.com/owner/repo" />
              <p className="mt-1 text-xs text-muted">For speed, Baton reads the latest 300 commits, 60 PRs, 60 issues and up to 30 docs/config files (README, docs/, workflows, .env.example, package files).</p>
              {repo.trim() && <AccessPicker label="Repository access" value={repoAccess} onChange={setRepoAccess} people={people} />}
            </div>
            <div className="mt-3 rounded-xl border border-line p-4">
              <label className="text-sm font-semibold text-navy" htmlFor="notes">Meeting notes or docs (.md, .txt, .pdf; up to 10 files, 2 MB each)</label>
              <input id="notes" type="file" multiple accept=".md,.markdown,.txt,.pdf" onChange={(e) => setNotes(Array.from(e.target.files ?? []))} className="mt-1 block text-sm" />
              {notes.length > 0 && <AccessPicker label="Notes access" value={notesAccess} onChange={setNotesAccess} people={people} />}
            </div>
            <div className="mt-3 rounded-xl border border-line p-4">
              <label className="text-sm font-semibold text-navy" htmlFor="chat">Chat export (Slack-style JSON)</label>
              <input id="chat" type="file" accept=".json" onChange={(e) => setChat(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
              <p className="mt-1 text-xs text-muted">A JSON array of messages with <code>ts</code>, <code>text</code>, <code>user</code> and optional <code>thread_ts</code>/<code>channel</code>. Each channel becomes its own source.</p>
              {chat && <AccessPicker label="Chat access" value={chatAccess} onChange={setChatAccess} people={people} />}
            </div>
            <p className="mt-2 text-xs text-muted">🛡 API keys, tokens and passwords are removed before anything is stored or sent to the AI.</p>
          </section>

          <section className="rounded-xl bg-panel p-4">
            <label className="flex items-start gap-2 text-sm text-navy">
              <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-1" />
              <span>I&apos;m authorised to use these sources, and they contain no confidential workplace data I don&apos;t have permission to share.</span>
            </label>
          </section>

          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200" role="alert">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg bg-navy px-5 py-3 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-60" data-testid="create-workspace">
              {busy ? "Creating…" : "Create workspace and reconstruct"}
            </button>
            <span className="text-xs text-muted">Takes about 2–6 minutes. Limited to 3 per visitor per day (free AI quota).</span>
          </div>
        </form>
      </main>
    </div>
  );
}

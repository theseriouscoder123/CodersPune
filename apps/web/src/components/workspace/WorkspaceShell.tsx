"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { api, ApiError, storePersona, type Member, type WorkspaceInfo } from "@/lib/api";

type Ctx = { ws: WorkspaceInfo; personaVersion: number };
const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside WorkspaceShell");
  return ctx;
}

const STEPS = [
  { key: "sources", href: "sources", label: "Connect", who: "all" },
  { key: "ledger", href: "ledger", label: "Reconstruct", who: "ledger" },
  { key: "review", href: "review", label: "Verify", who: "ledger" },
  { key: "preview", href: "review/preview", label: "Review", who: "reviewer" },
  { key: "handover", href: "handover", label: "Handover", who: "all" },
];

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-violet-50 text-violet-800 ring-violet-200",
  reviewer: "bg-violet-50 text-violet-800 ring-violet-200",
  leaver: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  successor: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  member: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${ROLE_STYLE[role] ?? ROLE_STYLE.member}`}>
      {role}
    </span>
  );
}

function Avatar({ m, size = 28 }: { m: Pick<Member, "name" | "color">; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: m.color ?? "#64748b", width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {m.name.slice(0, 1)}
    </span>
  );
}

function PersonaSwitcher({ ws, onSwitch }: { ws: WorkspaceInfo; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = ws.members.find((m) => m.id === ws.persona.id);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm hover:bg-panel"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="persona-switcher"
      >
        <span className="hidden text-xs text-muted sm:inline">Viewing as</span>
        {current && <Avatar m={current} size={22} />}
        <span className="font-semibold text-navy">{ws.persona.name}</span>
        <span className="hidden gap-1 sm:flex">
          {ws.persona.roles.filter((r) => r !== "member" || ws.persona.roles.length === 1).map((r) => <RoleBadge key={r} role={r} />)}
        </span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <li className="px-3 pt-2.5 pb-1 text-xs text-muted">Switch persona to see what each person is allowed to see.</li>
          {ws.members.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={m.id === ws.persona.id}
                onClick={() => {
                  setOpen(false);
                  onSwitch(m.id);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-panel ${m.id === ws.persona.id ? "bg-panel" : ""}`}
              >
                <Avatar m={m} />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-navy">{m.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {m.roles.map((r) => <RoleBadge key={r} role={r} />)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stepper({ ws }: { ws: WorkspaceInfo }) {
  const pathname = usePathname();
  const roles = ws.persona.roles;
  const allowed = (who: string) =>
    who === "all" || (who === "reviewer" ? roles.includes("reviewer") : roles.some((r) => ["reviewer", "admin", "leaver"].includes(r)));
  const activeKey = pathname.endsWith("/review/preview") ? "preview" : STEPS.find((s) => pathname.includes(`/${s.href}`))?.key
    ?? (pathname.includes("/runs/") ? "ledger" : "");
  return (
    <nav aria-label="Workflow steps" className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 text-sm">
        {STEPS.map((s, i) => {
          const active = s.key === activeKey;
          const ok = allowed(s.who);
          const base = "flex items-center gap-2 rounded-lg px-3 py-1.5";
          const body = (
            <>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${active ? "bg-amber text-navy" : "bg-white/15 text-white/80"}`}>
                {i + 1}
              </span>
              <span className={active ? "font-semibold text-white" : "text-white/75"}>{s.label}</span>
            </>
          );
          return (
            <li key={s.key} className="flex items-center gap-1">
              {ok ? (
                <Link href={`/w/${ws.id}/${s.href}`} className={`${base} ${active ? "bg-white/10" : "hover:bg-white/5"}`} aria-current={active ? "step" : undefined} data-testid={`step-${s.key}`}>
                  {body}
                </Link>
              ) : (
                <span className={`${base} cursor-not-allowed opacity-45`} title={`Not shared with ${ws.persona.name}`}>
                  {body}
                </span>
              )}
              {i < STEPS.length - 1 && <span className="text-white/30" aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WorkspaceShell({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personaVersion, setPersonaVersion] = useState(0);

  const load = useCallback(() => {
    api<WorkspaceInfo>(`/workspaces/${workspaceId}`, { workspaceId })
      .then(setWs)
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? "This workspace doesn't exist or isn't yours." : String(e)));
  }, [workspaceId]);

  useEffect(load, [load, personaVersion]);

  const switchPersona = (id: string) => {
    storePersona(workspaceId, id);
    setPersonaVersion((v) => v + 1); // every page refetches from the server under the new persona
  };

  if (error)
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-lg font-semibold text-navy">Couldn&apos;t open the workspace</p>
        <p className="mt-2 text-muted">{error}</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">Back to start</Link>
      </div>
    );
  if (!ws) return <div className="p-10 text-center text-muted">Loading workspace…</div>;

  return (
    <WorkspaceContext.Provider value={{ ws, personaVersion }}>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo small />
            <span className="text-line">/</span>
            <span className="font-semibold text-navy">{ws.name}</span>
            {ws.synthetic && (
              <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber/40" title="Fictional project written for this demo">
                Synthetic demo data
              </span>
            )}
          </div>
          <PersonaSwitcher ws={ws} onSwitch={switchPersona} />
        </div>
        <div className="bg-navy">
          <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
            <Stepper ws={ws} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </WorkspaceContext.Provider>
  );
}

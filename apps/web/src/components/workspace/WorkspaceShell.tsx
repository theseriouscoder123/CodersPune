"use client";

import { Check, ChevronDown, Eye, FileSearch, GitBranch, Handshake, History, Lock, RotateCcw, Scale, UserCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Logo } from "@/components/Logo";
import { TourChecklist } from "@/components/workspace/TourChecklist";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/Toast";
import { ButtonLink, Spinner } from "@/components/ui";
import { api, ApiError, storePersona, type WorkspaceInfo } from "@/lib/api";

type Ctx = { ws: WorkspaceInfo; personaVersion: number };
const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside WorkspaceShell");
  return ctx;
}

const STEPS = [
  { key: "sources", href: "sources", label: "Connect", who: "all", Icon: GitBranch },
  { key: "ledger", href: "ledger", label: "Reconstruct", who: "ledger", Icon: FileSearch },
  { key: "review", href: "review", label: "Verify", who: "ledger", Icon: Scale },
  { key: "preview", href: "review/preview", label: "Review", who: "reviewer", Icon: UserCheck },
  { key: "handover", href: "handover", label: "Handover", who: "all", Icon: Handshake },
];

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-strong text-on-strong ring-strong",
  reviewer: "bg-strong text-on-strong ring-strong",
  leaver: "bg-amber-soft text-amber-ink ring-amber/40",
  successor: "bg-verified-soft text-verified ring-verified/30",
  member: "bg-paper-2 text-ink-2 ring-line",
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`rounded-full px-2 py-[2px] text-[10.5px] font-semibold capitalize ring-1 ${ROLE_STYLE[role] ?? ROLE_STYLE.member}`}>{role}</span>
  );
}

const AVATAR = ["#14213d", "#2b5b88", "#1f6f4a", "#b5531a", "#8a5a06", "#0e7490", "#6d4c41", "#3f5f3a"];
export function avatarColor(handle: string) {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function Avatar({ m, size = 28 }: { m: { name: string; handle: string }; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-card"
      style={{ background: avatarColor(m.handle), width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {m.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function shownRoles(roles: string[]) {
  const r = roles.filter((x) => x !== "member" && !(x === "admin" && roles.includes("reviewer")));
  return r.length ? r : ["member"];
}

function PersonaSwitcher({ ws, onSwitch }: { ws: WorkspaceInfo; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const me = ws.members.find((m) => m.id === ws.persona.id);
  const ref = useRef<HTMLDivElement>(null);
  const current = ws.members.find((m) => m.id === ws.persona.id);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (ws.persona_locked) {
    // Identity comes from this person's invite link; the server won't accept anyone else.
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-card py-1.5 pl-1.5 pr-3 text-sm" data-testid="persona-locked"
        title="You joined through a private invite link, so you always see this workspace as yourself.">
        {me && <Avatar m={me} size={28} />}
        <span className="text-left leading-tight">
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted"><Lock className="h-2.5 w-2.5" /> Signed in as</span>
          <span className="block font-semibold text-ink">{ws.persona.name}</span>
        </span>
        <span className="hidden gap-1 sm:flex">{shownRoles(ws.persona.roles).map((r) => <RoleBadge key={r} role={r} />)}</span>
      </div>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid="persona-switcher"
        className="flex items-center gap-2.5 rounded-xl border border-line bg-card py-1.5 pl-1.5 pr-3 text-sm shadow-[var(--shadow-sm)] transition hover:border-line-2 hover:shadow-[var(--shadow-md)]">
        {current && <Avatar m={current} size={28} />}
        <span className="text-left leading-tight">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-muted">Viewing as</span>
          <span className="block font-semibold text-ink">{ws.persona.name}</span>
        </span>
        <span className="hidden gap-1 sm:flex">{shownRoles(ws.persona.roles).map((r) => <RoleBadge key={r} role={r} />)}</span>
        <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="animate-pop absolute right-0 z-30 mt-2 w-80 origin-top-right overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-lg)]" role="listbox">
          <p className="border-b border-line px-4 py-3 text-xs text-muted">
            Switch persona to see exactly what each person is allowed to see. The server enforces it.
          </p>
          <ul className="p-1.5">
            {ws.members.map((m) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={m.id === ws.persona.id} onClick={() => { setOpen(false); if (m.id !== ws.persona.id) onSwitch(m.id); }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-paper ${m.id === ws.persona.id ? "bg-paper" : ""}`}>
                  <Avatar m={m} size={34} />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-ink">{m.name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">{shownRoles(m.roles).map((r) => <RoleBadge key={r} role={r} />)}</span>
                  </span>
                  {m.id === ws.persona.id && <Check className="h-4 w-4 text-verified" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stepper({ ws }: { ws: WorkspaceInfo }) {
  const pathname = usePathname();
  const roles = ws.persona.roles;
  const allowed = (who: string) =>
    who === "all" || (who === "reviewer" ? roles.includes("reviewer") : roles.some((r) => ["reviewer", "admin", "leaver"].includes(r)));
  const activeKey = pathname.endsWith("/review/preview") ? "preview"
    : STEPS.find((s) => pathname.includes(`/${s.href}`))?.key ?? (pathname.includes("/runs/") ? "ledger" : "");
  const activeIdx = STEPS.findIndex((s) => s.key === activeKey);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // On narrow screens keep the current step visible in the horizontally scrolling stepper.
    navRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeKey]);

  return (
    <nav ref={navRef} aria-label="Workflow steps" className="no-scrollbar -mx-1 overflow-x-auto px-1">
      <ol className="flex min-w-max items-center">
        {STEPS.map((s, i) => {
          const active = i === activeIdx;
          const ok = allowed(s.who);
          const done = i < activeIdx && ok;
          const node = (
            <span className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition ${active ? "bg-card shadow-[var(--shadow-sm)] ring-1 ring-line" : ok ? "hover:bg-card/70" : ""}`}>
              <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition ${
                active ? "bg-strong text-on-strong" : done ? "bg-verified-solid text-white" : ok ? "bg-card text-ink-2 ring-1 ring-line-2" : "bg-paper-2 text-muted"}`}>
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : !ok ? <Lock className="h-3 w-3" /> : <s.Icon className="h-3.5 w-3.5" strokeWidth={2.2} />}
              </span>
              <span className="leading-tight">
                <span className={`block text-[10px] font-semibold uppercase tracking-wider ${active ? "text-amber-ink" : "text-muted"}`}>Step {i + 1}</span>
                <span className={`block text-[13px] font-semibold ${active ? "text-ink" : ok ? "text-ink-2" : "text-muted"}`}>{s.label}</span>
              </span>
            </span>
          );
          return (
            <li key={s.key} className="flex items-center">
              {ok ? (
                <Link href={`/w/${ws.id}/${s.href}`} aria-current={active ? "step" : undefined} data-testid={`step-${s.key}`}>{node}</Link>
              ) : (
                <span className="cursor-not-allowed opacity-70" title={`Not shared with ${ws.persona.name}`}>{node}</span>
              )}
              {i < STEPS.length - 1 && (
                <span className="relative mx-1 h-px w-6 bg-line-2 sm:w-10" aria-hidden>
                  <span className={`absolute inset-0 origin-left bg-verified-solid transition-transform duration-500 ${i < activeIdx && allowed(STEPS[i + 1].who) ? "scale-x-100" : "scale-x-0"}`} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WorkspaceShell({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [result, setResult] = useState<{ ws?: WorkspaceInfo; error?: string } | null>(null);
  const [personaVersion, setPersonaVersion] = useState(0);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(() => {
    api<WorkspaceInfo>(`/workspaces/${workspaceId}`, { workspaceId })
      .then((ws) => setResult({ ws }))
      .catch((e: unknown) => setResult({ error: e instanceof ApiError && e.status === 404 ? "This workspace doesn't exist or belongs to another visitor." : String(e) }));
  }, [workspaceId]);

  useEffect(load, [load, personaVersion]);

  const switchPersona = (id: string) => {
    storePersona(workspaceId, id);
    setPersonaVersion((v) => v + 1);
  };

  async function resetDemo() {
    if (!confirm("Reset the demo? Your reviews and approvals in this copy will be discarded.")) return;
    setResetting(true);
    try {
      const r = await api<{ workspace_id: string }>("/demo/reset", { method: "POST" });
      router.push(`/w/${r.workspace_id}/sources`);
    } finally {
      setResetting(false);
    }
  }

  if (result?.error)
    return (
      <div className="paper-grain flex flex-1 items-center justify-center px-4">
        <div className="animate-pop max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-[var(--shadow-md)]">
          <p className="font-display text-xl font-semibold text-ink">Couldn&apos;t open this workspace</p>
          <p className="mt-2 text-sm text-muted">{result.error}</p>
          <ButtonLink href="/" className="mt-6">Back to start</ButtonLink>
        </div>
      </div>
    );
  const ws = result?.ws;
  if (!ws)
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-muted"><Spinner /> Opening workspace…</div>
    );

  return (
    <ToastProvider>
      <WorkspaceContext.Provider value={{ ws, personaVersion }}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-strong focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-strong">
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Logo small />
              <span className="h-5 w-px bg-line-2" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{ws.name}</p>
                <div className="flex items-center gap-1.5">
                  {ws.synthetic && <span className="text-[11px] font-medium text-amber-ink" title="Fictional project written for this demo">● Synthetic demo data</span>}
                  {ws.read_only && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Eye className="h-3 w-3" /> read-only</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ws.synthetic && !ws.read_only && (
                <button onClick={resetDemo} disabled={resetting} title="Discard your changes and start the demo again"
                  className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted transition hover:bg-paper-2 hover:text-ink sm:inline-flex">
                  {resetting ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />} Reset demo
                </button>
              )}
              {(ws.persona.roles.includes("admin") || ws.persona.roles.includes("reviewer")) && !ws.read_only && (
                <Link href={`/w/${ws.id}/activity`} title="Activity log: who did what, when" aria-label="Activity log"
                  className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 transition hover:bg-paper-2 hover:text-ink" data-testid="activity-link">
                  <History className="h-4 w-4" />
                </Link>
              )}
              {(ws.persona.roles.includes("admin") || ws.persona.roles.includes("reviewer")) && !ws.read_only && (
                <Link href={`/w/${ws.id}/team`} title="People, invite links and access" aria-label="Team and access"
                  className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 transition hover:bg-paper-2 hover:text-ink" data-testid="team-link">
                  <UsersRound className="h-4 w-4" />
                </Link>
              )}
              <ThemeToggle />
              <PersonaSwitcher ws={ws} onSwitch={switchPersona} />
            </div>
          </div>
          <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
            <Stepper ws={ws} />
          </div>
        </header>
        <main id="main" tabIndex={-1} key={personaVersion} className="animate-fade outline-none mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6">{children}</main>
        {ws.synthetic && <TourChecklist ws={ws} onSwitchPersona={switchPersona} />}
      </WorkspaceContext.Provider>
    </ToastProvider>
  );
}

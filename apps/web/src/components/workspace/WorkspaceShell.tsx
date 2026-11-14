"use client";

import { CalendarDays, Check, ChevronsUpDown, Gauge, History, Info, Lock, Menu, MessageCircleQuestion, Search, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useConfirm } from "@/components/Confirm";
import { LeaverBanner } from "@/components/interview/LeaverBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/Toast";
import { TryDemoButton } from "@/components/TryDemoButton";
import { ButtonLink, Kbd, Spinner } from "@/components/ui";
import { canSearch, SearchPalette } from "@/components/workspace/SearchPalette";
import { TourChecklist } from "@/components/workspace/TourChecklist";
import { api, ApiError, storePersona, type WorkspaceInfo } from "@/lib/api";

type Ctx = { ws: WorkspaceInfo; personaVersion: number; switchPersona?: (id: string) => void };
const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside WorkspaceShell");
  return ctx;
}

type Nav = {
  sources: { visible: number; total: number }; claims?: number; to_review?: number;
  handover?: { id: string; version: number | null; acks?: { done: number; total: number; questions_open: number; questions_answered: number } };
};

const STEPS = [
  { key: "sources", href: "sources", label: "Connect", who: "all" },
  { key: "ledger", href: "ledger", label: "Reconstruct", who: "ledger" },
  { key: "review", href: "review", label: "Verify", who: "ledger" },
  { key: "preview", href: "review/preview", label: "Review & approve", who: "reviewer" },
  { key: "handover", href: "handover", label: "Handover", who: "all" },
] as const;

/** Pages that lay out their own full-height panes (no centred column). */
const FULL_BLEED = [/\/review$/];

const PAGE_TITLES: [RegExp, string][] = [
  [/\/sources$/, "Connect"], [/\/ledger$/, "Reconstruct"], [/\/runs\//, "Pipeline run"], [/\/review\/preview$/, "Review & approve"],
  [/\/review$/, "Verify"], [/\/handover$/, "Handover"], [/\/first-week$/, "First week"], [/\/leaving$/, "Before the last day"],
  [/\/interview\//, "Gap interview"], [/\/risk$/, "Knowledge risk"], [/\/activity$/, "Activity"], [/\/team$/, "Team & access"],
  [/\/health$/, "Pipeline health"],
];

/* ------------------------------------------------------------------ avatars, roles */

const AVATAR = ["#B45309", "#0E7490", "#4D7C0F", "#475569", "#9F1239", "#1D4ED8", "#6D4C41", "#0F766E"];
export function avatarColor(handle: string) {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function Avatar({ m, size = 22 }: { m: { name: string; handle: string }; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-bg"
      style={{ background: avatarColor(m.handle), width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.44)) }} aria-hidden>
      {m.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function shownRoles(roles: string[]) {
  const r = roles.filter((x) => x !== "member" && !(x === "admin" && roles.includes("reviewer")));
  return r.length ? r : ["member"];
}
const ROLE_LABEL: Record<string, string> = { admin: "Admin", reviewer: "Reviewer", leaver: "Leaving", successor: "Taking over", member: "Member" };

export function RoleBadge({ role }: { role: string }) {
  return <span className="rounded-[4px] border border-line px-1.5 text-[11px] font-medium leading-[18px] text-fg-3">{ROLE_LABEL[role] ?? role}</span>;
}

/* ------------------------------------------------------------------ top-bar actions slot */

/** Pages render their actions here, so they sit in the top bar next to the breadcrumb (at most one primary). */
const noSubscribe = () => () => {};
export function TopbarActions({ children }: { children: React.ReactNode }) {
  const el = useSyncExternalStore(noSubscribe, () => document.getElementById("topbar-actions"), () => null);
  return el ? createPortal(children, el) : null;
}

/* ------------------------------------------------------------------ person switcher (sidebar footer) */

function PersonaSwitcher({ ws, onSwitch }: { ws: WorkspaceInfo; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = ws.members.find((m) => m.id === ws.persona.id);
  const roleText = shownRoles(ws.persona.roles).map((r) => ROLE_LABEL[r] ?? r).join(", ");
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
      <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1" data-testid="persona-locked"
        title="You joined through a private invite link, so you always see this workspace as yourself.">
        {me && <Avatar m={me} size={24} />}
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[13px] font-medium text-fg">{ws.persona.name}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-fg-3"><Lock className="h-3 w-3" /> Signed in as · {roleText}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid="persona-switcher"
        className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover">
        {me && <Avatar m={me} size={24} />}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium text-fg">{ws.persona.name}</span>
          <span className="block truncate text-[11.5px] text-fg-3">Viewing as · {roleText}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-3" />
      </button>
      {open && (
        <div className="animate-pop absolute bottom-full left-0 z-40 mb-1.5 w-72 overflow-hidden rounded-lg border border-line bg-bg shadow-[var(--pop)]" role="listbox" data-testid="persona-menu">
          <p className="border-b border-line px-3 py-2.5 text-[12px] leading-[17px] text-fg-3">
            Switch person to see exactly what each person is allowed to see. The server enforces it.
          </p>
          <ul className="p-1">
            {ws.members.map((m) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={m.id === ws.persona.id} onClick={() => { setOpen(false); if (m.id !== ws.persona.id) onSwitch(m.id); }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover ${m.id === ws.persona.id ? "bg-active" : ""}`}>
                  <Avatar m={m} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-fg">{m.name}</span>
                    <span className="block text-[11.5px] text-fg-3">{shownRoles(m.roles).map((r) => ROLE_LABEL[r] ?? r).join(", ")}</span>
                  </span>
                  {m.id === ws.persona.id && <Check className="h-3.5 w-3.5 text-fg-2" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ step-state icons */

function StepIcon({ state }: { state: "done" | "current" | "todo" | "locked" }) {
  if (state === "locked") return <Lock className="h-3.5 w-3.5 shrink-0 text-fg-4" aria-hidden />;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden>
      {state === "done" && <><circle cx="7" cy="7" r="6" fill="var(--fg-3)" /><path d="M4.4 7.2l1.7 1.7 3.5-3.6" stroke="var(--bg-side)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
      {state === "current" && <><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--accent)" strokeWidth="1.5" /><path d="M7 3.2a3.8 3.8 0 0 1 0 7.6z" fill="var(--accent)" /></>}
      {state === "todo" && <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--fg-4)" strokeWidth="1.5" />}
    </svg>
  );
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({ ws, nav, onSwitch, onReset, resetting }: { ws: WorkspaceInfo; nav: Nav | null; onSwitch: (id: string) => void; onReset: () => void; resetting: boolean }) {
  const pathname = usePathname();
  const roles = ws.persona.roles;
  const isReviewer = roles.includes("reviewer");
  const isSuccessor = roles.includes("successor");
  const manage = roles.includes("admin") || isReviewer;
  const allowed = (who: string) => who === "all" || (who === "reviewer" ? isReviewer : roles.some((r) => ["reviewer", "admin", "leaver"].includes(r)));
  const activeKey = pathname.endsWith("/review/preview") ? "preview"
    : STEPS.find((s) => pathname.endsWith(`/${s.href}`) || pathname.includes(`/${s.href}/`) && s.key !== "review")?.key
      ?? (pathname.includes("/runs/") ? "ledger" : pathname.endsWith("/first-week") ? "handover" : "");
  const activeIdx = STEPS.findIndex((s) => s.key === activeKey);
  const leaver = ws.members.find((m) => m.roles.includes("leaver"));
  const successor = ws.members.find((m) => m.roles.includes("successor"));
  const h = nav?.handover;
  const count: Record<string, string | undefined> = {
    sources: nav ? (nav.sources.visible < nav.sources.total ? `${nav.sources.visible} of ${nav.sources.total} sources` : `${nav.sources.total} source${nav.sources.total === 1 ? "" : "s"}`) : undefined,
    ledger: nav?.claims !== undefined ? String(nav.claims) : undefined,
    review: nav?.to_review !== undefined ? (nav.to_review ? `${nav.to_review} left` : "All reviewed") : undefined,
    preview: h ? (h.version ? `v${h.version} approved` : "Draft") : undefined,
    handover: h ? (h.acks ? `${h.acks.done} / ${h.acks.total}` : h.version ? `v${h.version}` : "Not sent") : undefined,
  };
  const questions = (h?.acks?.questions_open ?? 0) + (h?.acks?.questions_answered ?? 0);
  const navLink = (active: boolean) =>
    `flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${active ? "bg-active font-medium text-fg" : "text-fg-2 hover:bg-hover hover:text-fg"}`;

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5 pt-2.5 scroll-quiet" data-sidebar>
      {/* workspace */}
      <div className="flex h-8 items-center gap-2 rounded-md px-1.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-fg text-[9.5px] font-bold text-bg" aria-hidden>
          {ws.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{ws.name}</span>
        {ws.read_only && <span className="text-[11px] text-fg-3">read-only</span>}
      </div>

      {canSearch(ws) && (
        <button type="button" onClick={() => window.dispatchEvent(new Event("baton:search"))} aria-label="Search (Ctrl+K)" data-testid="search-open"
          className="mt-1 flex h-7 items-center gap-2 rounded-md border border-line bg-bg px-2 text-[12.5px] text-fg-3 transition-colors hover:border-line-2">
          <Search className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">Search claims, sources</span><Kbd>Ctrl</Kbd><Kbd>K</Kbd>
        </button>
      )}

      {/* the five workflow steps */}
      <div className="mt-4 flex items-center justify-between px-2 pb-1">
        <span className="text-[12px] font-medium text-fg-3">Handover</span>
        {leaver && successor && (
          <span className="flex items-center gap-1" title={`${leaver.name} → ${successor.name}`}>
            <Avatar m={leaver} size={16} /><span className="text-[10px] text-fg-4">→</span><Avatar m={successor} size={16} />
          </span>
        )}
      </div>
      <nav aria-label="Workflow steps">
        <ol className="space-y-px">
          {STEPS.map((s, i) => {
            const ok = allowed(s.who);
            const active = i === activeIdx;
            const state = !ok ? "locked" : active ? "current" : i < activeIdx ? "done" : "todo";
            const inner = (
              <>
                <StepIcon state={state} />
                <span className="flex-1 truncate">{s.label}</span>
                {count[s.key] && ok && <span className={`text-[12px] ${active ? "text-fg-2" : "text-fg-3"}`}>{count[s.key]}</span>}
              </>
            );
            return (
              <li key={s.key}>
                {ok ? (
                  <Link href={`/w/${ws.id}/${s.href}`} aria-current={active ? "step" : undefined} data-testid={`step-${s.key}`} className={navLink(active)}>{inner}</Link>
                ) : (
                  <span className="flex h-7 cursor-not-allowed items-center gap-2 rounded-md px-2 text-[13px] text-fg-4" tabIndex={0} aria-disabled="true"
                    title={s.who === "reviewer" ? `Only the reviewer works in this step. ${ws.persona.name} sees the approved handover instead.` : `The ledger is for the reviewer and the leaver. ${ws.persona.name} sees the approved handover (step 5).`}>
                    {inner}
                  </span>
                )}
                {s.key === "handover" && isSuccessor && h?.version && (
                  <div className="mt-px space-y-px pl-6">
                    <Link href={`/w/${ws.id}/first-week`} className={navLink(pathname.endsWith("/first-week"))}><CalendarDays className="h-3.5 w-3.5 text-fg-3" /> Your first week</Link>
                    <Link href={`/w/${ws.id}/handover#acks`} className={navLink(false)}>
                      <MessageCircleQuestion className="h-3.5 w-3.5 text-fg-3" /> <span className="flex-1">Your questions</span>
                      {questions > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-white">{questions}</span>}
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {manage && (
        <>
          <p className="mt-4 px-2 pb-1 text-[12px] font-medium text-fg-3">Workspace</p>
          <Link href={`/w/${ws.id}/risk`} data-testid="risk-link" className={navLink(pathname.endsWith("/risk"))} title="Knowledge risk: what would be lost if one person left" aria-label="Knowledge risk">
            <Gauge className="h-3.5 w-3.5 text-fg-3" /> Knowledge risk
          </Link>
          {!ws.read_only && (
            <Link href={`/w/${ws.id}/activity`} data-testid="activity-link" className={navLink(pathname.endsWith("/activity"))} title="Activity log: who did what, when" aria-label="Activity log">
              <History className="h-3.5 w-3.5 text-fg-3" /> Activity
            </Link>
          )}
          {!ws.read_only && (
            <Link href={`/w/${ws.id}/team`} data-testid="team-link" className={navLink(pathname.endsWith("/team"))} title="People, invite links and access" aria-label="Team and access">
              <UsersRound className="h-3.5 w-3.5 text-fg-3" /> Team &amp; access
            </Link>
          )}
        </>
      )}

      {ws.synthetic && <div className="mt-4"><TourChecklist ws={ws} onSwitchPersona={onSwitch} /></div>}

      <div className="min-h-4 flex-1" />

      {(ws.synthetic || ws.read_only) && (
        <div className="rounded-lg border border-dashed border-line-2 px-3 py-2.5 text-[12px] leading-[17px] text-fg-3">
          {ws.synthetic && (
            <>
              <p className="flex items-center gap-1.5 font-medium text-fg-2"><Info className="h-3.5 w-3.5" /> Synthetic demo data</p>
              <p className="mt-0.5">A fictional student-club project.{ws.read_only ? "" : " Your copy is private."}</p>
            </>
          )}
          {ws.read_only && <p className="mt-1">This is the shared read-only template. Try the demo to get your own copy.</p>}
          {ws.synthetic && !ws.read_only && (
            <button type="button" onClick={onReset} disabled={resetting} aria-label="Reset demo" title="Discard your changes and start the demo again"
              className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-accent-ink hover:underline disabled:opacity-60">
              {resetting && <Spinner className="h-3 w-3" />} Reset demo
            </button>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
        <PersonaSwitcher ws={ws} onSwitch={onSwitch} />
        <ThemeToggle />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ top bar */

function TopBar({ ws, onMenu }: { ws: WorkspaceInfo; onMenu: () => void }) {
  const pathname = usePathname();
  const leaver = ws.members.find((m) => m.roles.includes("leaver"));
  const successor = ws.members.find((m) => m.roles.includes("successor"));
  const title = PAGE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? "";
  return (
    <header className="no-print sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur sm:px-4">
      <button type="button" onClick={onMenu} aria-label="Open navigation" className="grid h-7 w-7 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg lg:hidden">
        <Menu className="h-4 w-4" />
      </button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {leaver && successor && <span className="hidden truncate text-fg-3 sm:inline">{leaver.name} → {successor.name}</span>}
        {leaver && successor && title && <span className="hidden text-fg-4 sm:inline">/</span>}
        {title && <span className="truncate font-medium text-fg">{title}</span>}
      </nav>
      <div id="topbar-actions" className="ml-auto flex min-w-0 items-center gap-2" />
    </header>
  );
}

/* ------------------------------------------------------------------ shell */

export function WorkspaceShell({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [result, setResult] = useState<{ ws?: WorkspaceInfo; error?: string } | null>(null);
  const [personaVersion, setPersonaVersion] = useState(0);
  const [resetting, setResetting] = useState(false);
  // The phone drawer belongs to the page it was opened on: navigating or switching person closes it.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const [nav, setNav] = useState<Nav | null>(null);
  const confirmDialog = useConfirm();

  const load = useCallback(() => {
    api<WorkspaceInfo>(`/workspaces/${workspaceId}`, { workspaceId })
      .then((ws) => setResult({ ws }))
      .catch((e: unknown) => setResult(e instanceof ApiError && (e.status === 404 || e.status === 422) ? { error: "private" } : { error: e instanceof Error ? e.message : String(e) }));
  }, [workspaceId]);
  useEffect(load, [load, personaVersion]);

  const personaId = result?.ws?.persona.id;
  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    api<Nav>(`/workspaces/${workspaceId}/nav`, { workspaceId, persona: personaId }).then((n) => !cancelled && setNav(n)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, personaId, pathname, personaVersion]);

  const here = `${pathname}|${personaVersion}`;
  const drawer = drawerAt === here;
  const setDrawer = (open: boolean) => setDrawerAt(open ? here : null);

  const switchPersona = (id: string) => {
    storePersona(workspaceId, id);
    setPersonaVersion((v) => v + 1);
  };

  async function resetDemo() {
    if (!(await confirmDialog({ title: "Start the demo again?", body: "Your reviews, approvals and settings in this copy are discarded and you get a fresh copy of the demo project.",
      confirmLabel: "Reset demo", tone: "danger" }))) return;
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
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-[10px] border border-line bg-bg p-6 text-center">
          <div className="mx-auto mb-3 grid h-8 w-8 place-items-center rounded-md border border-line text-fg-3"><Lock className="h-4 w-4" /></div>
          {result.error === "private" ? (
            <>
              <p className="text-[14px] font-semibold text-fg">This workspace is private</p>
              <p className="mt-1.5 text-[13px] leading-5 text-fg-3">
                A workspace belongs to the browser that created it and to people invited with a private link. Ask its owner for an
                invite link, or open your own copy of the demo.
              </p>
              <div className="mt-5 flex flex-col items-center gap-2">
                <TryDemoButton />
                <ButtonLink href="/" variant="ghost" size="sm">Go to the start page</ButtonLink>
              </div>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-fg">Couldn&apos;t open this workspace</p>
              <p className="mt-1.5 text-[13px] text-fg-3">{result.error}</p>
              <ButtonLink href="/" className="mt-5">Go to the start page</ButtonLink>
            </>
          )}
        </div>
      </div>
    );
  const ws = result?.ws;
  if (!ws) return <div className="flex flex-1 items-center justify-center gap-2.5 text-[13px] text-fg-3"><Spinner className="h-4 w-4" /> Opening workspace…</div>;

  const sidebar = <Sidebar ws={ws} nav={nav} onSwitch={switchPersona} onReset={resetDemo} resetting={resetting} />;
  return (
    <ToastProvider>
      <WorkspaceContext.Provider value={{ ws, personaVersion, switchPersona }}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-50 focus:rounded-md focus:bg-fg focus:px-3 focus:py-1.5 focus:text-[13px] focus:font-medium focus:text-bg">
          Skip to content
        </a>
        <div className="flex min-h-screen w-full">
          <aside className="no-print sticky top-0 hidden h-screen w-[236px] shrink-0 border-r border-line bg-bg-side lg:block" aria-label="Workspace navigation">
            {sidebar}
          </aside>
          {drawer && (
            <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
              <div className="animate-fade absolute inset-0 bg-[var(--overlay)]" onClick={() => setDrawer(false)} />
              <div className="animate-drawer absolute inset-y-0 left-0 w-[min(280px,86vw)] border-r border-line bg-bg-side">
                <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="absolute right-2 top-2.5 grid h-7 w-7 place-items-center rounded-md text-fg-3 hover:bg-hover">
                  <X className="h-4 w-4" />
                </button>
                {sidebar}
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar ws={ws} onMenu={() => setDrawer(true)} />
            <LeaverBanner />
            <main id="main" tabIndex={-1} key={personaVersion} className="w-full min-w-0 flex-1 outline-none">
              {FULL_BLEED.some((re) => re.test(pathname)) ? children : <PageBody>{children}</PageBody>}
            </main>
          </div>
        </div>
        {canSearch(ws) && <SearchPalette ws={ws} />}
      </WorkspaceContext.Provider>
    </ToastProvider>
  );
}

/** Centred document column used by most pages (max 1160px, 32px × 40px padding; tighter on phones). */
export function PageBody({ children, wide = false, className = "" }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return <div className={`mx-auto w-full ${wide ? "max-w-[1240px]" : "max-w-[1160px]"} px-4 pb-24 pt-6 sm:px-8 sm:pt-8 lg:px-10 ${className}`}>{children}</div>;
}

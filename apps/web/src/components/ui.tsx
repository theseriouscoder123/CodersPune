"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ Button
 * 28px tall, radius 6, 13px/500. primary = accent fill; secondary = bordered; ghost = transparent;
 * danger = secondary with red text; success = secondary with a green icon. ("amber" is kept as an alias of primary.)
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "amber";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover",
  amber: "bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-bg text-fg border border-line-2 hover:bg-hover",
  ghost: "text-fg-2 border border-transparent hover:bg-hover hover:text-fg",
  danger: "bg-bg text-mis border border-line-2 hover:bg-mis-soft",
  success: "bg-bg text-fg border border-line-2 hover:bg-hover [&>svg:first-child]:text-ver",
};
const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-8 px-3 text-[13px] gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5",
  lg: "h-9 px-4 text-[14px] gap-2 [&_svg]:h-4 [&_svg]:w-4",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 ease-out disabled:pointer-events-none ${VARIANT[variant]} disabled:border-line-2 disabled:bg-hover disabled:text-fg-3 disabled:[&_svg]:text-fg-3 [&:disabled_kbd]:border-line-2 [&:disabled_kbd]:text-fg-3 ${SIZE[size]} ${extra}`;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }, ref) {
  return (
    // A loading button keeps its colour (it isn't "disabled", it's busy) but ignores clicks until it finishes.
    <button ref={ref} className={buttonClass(variant, size, `${loading && !disabled ? "pointer-events-none" : ""} ${className}`)} disabled={disabled}
      aria-busy={loading || undefined} aria-disabled={loading || undefined} {...rest}
      onClick={loading ? (e) => e.preventDefault() : rest.onClick}>
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className = "", children, ...rest }:
  { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return <Link href={href} className={buttonClass(variant, size, className)} {...rest}>{children}</Link>;
}

/** 28×28 icon-only button. Always pass an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }>(
  function IconButton({ className = "", children, ...rest }, ref) {
    return (
      <button ref={ref} type="button" className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4 ${className}`} {...rest}>
        {children}
      </button>
    );
  });

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex [@media(pointer:coarse)]:hidden h-[17px] min-w-[17px] items-center justify-center rounded-[4px] border border-line-2 border-b-[1.5px] bg-bg px-1 font-sans text-[10.5px] font-medium leading-none text-fg-3 ${className}`}>
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-line bg-bg ${className}`} {...rest}>{children}</div>;
}

/** Page title (24px/650), description in fg-3, actions on the right. The eyebrow is kept for the API but not shown
 *  (the breadcrumb in the top bar says where you are). */
export function PageHeader({ title, description, actions }:
  { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[720px]">
        <h1 className="text-[24px] font-[650] leading-8 tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1.5 text-[13.5px] leading-[21px] text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-3.5 py-3">
          <Skeleton className="mt-0.5 h-3.5 w-3.5 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-10/12" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Empty, error and "not for you" states: a 16px icon in a 32px rounded square, a 13px title, a 12.5px line. */
export function EmptyState({ icon, title, children, action }:
  { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-line px-6 py-10 text-center">
      {icon && <div className="mb-3 grid h-8 w-8 place-items-center rounded-md border border-line text-fg-3 [&_svg]:h-4 [&_svg]:w-4">{icon}</div>}
      <p className="text-[13px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-1 max-w-md text-[12.5px] leading-[19px] text-fg-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Notice: a bordered box on bg-sunk with a semantic icon; warnings use the soft tint. */
export function Alert({ tone = "info", children, className = "" }:
  { tone?: "info" | "error" | "success" | "warn"; children: React.ReactNode; className?: string }) {
  const t = {
    info: { box: "border-line bg-bg-sunk", icon: <Info className="h-4 w-4 text-accent-ink" /> },
    error: { box: "border-line bg-bg-sunk", icon: <XCircle className="h-4 w-4 text-mis" /> },
    success: { box: "border-line bg-bg-sunk", icon: <CheckCircle2 className="h-4 w-4 text-ver" /> },
    warn: { box: "border-con/25 bg-con-soft", icon: <AlertTriangle className="h-4 w-4 text-con" /> },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] text-fg ${t.box} ${className}`}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-line px-1.5 text-[12px] font-medium text-fg-2 ${className}`}>{children}</span>;
}

/** Notion-style property list: a label column (icon + label in fg-3) and values in fg. */
export function PropertyList({ rows, labelWidth = 124, className = "" }:
  { rows: { icon?: React.ReactNode; label: string; value: React.ReactNode; testid?: string }[]; labelWidth?: number; className?: string }) {
  return (
    <dl className={`grid gap-y-0.5 text-[13px] ${className}`} style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}>
      {rows.map((r) => (
        <div key={r.label} className="contents" data-testid={r.testid}>
          <dt className="flex min-h-[28px] items-center gap-2 text-fg-3 [&_svg]:h-3.5 [&_svg]:w-3.5">{r.icon}{r.label}</dt>
          <dd className="flex min-h-[28px] min-w-0 flex-wrap items-center gap-x-2 text-fg">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Boxed list: hairline border, radius 8, rows divided by hairlines, optional sunk header and footer. */
export function BoxedList({ header, footer, children, className = "", ...rest }:
  { header?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div className={`overflow-hidden rounded-lg border border-line bg-bg ${className}`} {...rest}>
      {header && <div className="border-b border-line bg-bg-sunk px-3.5 py-2 text-[12px] font-medium text-fg-3">{header}</div>}
      <div className="divide-y divide-line">{children}</div>
      {footer && <div className="border-t border-line bg-bg-sunk px-3.5 py-2 text-[12.5px] text-fg-3">{footer}</div>}
    </div>
  );
}

/** Section heading used inside pages: 16px/600 title, a muted count, an optional line, optional right side. */
export function SectionTitle({ title, count, hint, right, id }:
  { title: React.ReactNode; count?: number | string; hint?: React.ReactNode; right?: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2" id={id}>
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg">{title}{count !== undefined && <span className="ml-1.5 text-[13px] font-normal text-fg-3">{count}</span>}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-fg-3">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal / drawer */

// Overlays render into <body> so ancestors with their own stacking context can't trap them under the top bar.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus management for dialogs: focus moves in on open, Tab stays inside, Escape closes, focus returns on close. */
function useDialogFocus(panel: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const previously = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previously?.focus?.();
    };
  }, [panel]);
}

function ModalPanel({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div className="animate-fade glass-scrim fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
        className="animate-pop scroll-quiet max-h-[calc(100vh-32px)] w-full max-w-[480px] overflow-auto rounded-[10px] border border-line glass-pop p-5 outline-none" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<ModalPanel onClose={onClose} label={label}>{children}</ModalPanel>, document.body);
}

function DrawerPanel({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div className="animate-fade glass-scrim fixed inset-0 z-50 flex justify-end bg-[var(--overlay)]" onClick={onClose}>
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
        className="animate-drawer scroll-quiet h-full w-full max-w-[540px] overflow-auto border-l border-line glass-pop outline-none" onClick={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<DrawerPanel onClose={onClose} label={label}>{children}</DrawerPanel>, document.body);
}

"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ Button */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "amber";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2 shadow-[var(--shadow-sm)]",
  secondary: "bg-card text-ink ring-1 ring-line-2 hover:bg-paper-2 hover:ring-ink/20",
  ghost: "text-ink-2 hover:bg-paper-2",
  danger: "bg-card text-missing ring-1 ring-missing/30 hover:bg-missing-soft",
  success: "bg-verified text-white hover:bg-verified/90 shadow-[var(--shadow-sm)]",
  amber: "bg-amber text-ink hover:brightness-105 shadow-[var(--shadow-sm)]",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `inline-flex select-none items-center justify-center rounded-xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className = "", children, ...rest }:
  { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return <Link href={href} className={buttonClass(variant, size, className)} {...rest}>{children}</Link>;
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-line bg-card shadow-[var(--shadow-sm)] ${className}`} {...rest}>{children}</div>;
}

export function PageHeader({ eyebrow, title, description, actions }:
  { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="animate-rise flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-ink">{eyebrow}</p>}
        <h1 className="font-display mt-1 text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>}
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
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-4 w-11/12" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }:
  { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="animate-fade flex flex-col items-center rounded-2xl border border-dashed border-line-2 bg-card/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-paper-2 text-ink-2">{icon}</div>}
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children, className = "" }:
  { tone?: "info" | "error" | "success" | "warn"; children: React.ReactNode; className?: string }) {
  const t = {
    info: "bg-supported-soft text-supported ring-supported/20",
    error: "bg-missing-soft text-missing ring-missing/20",
    success: "bg-verified-soft text-verified ring-verified/20",
    warn: "bg-amber-soft text-amber-ink ring-amber/30",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={`animate-fade rounded-xl px-4 py-3 text-sm ring-1 ${t} ${className}`}>{children}</div>;
}

export function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full bg-paper-2 px-2.5 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-line ${className}`}>{children}</span>;
}

/* ------------------------------------------------------------------ Modal / drawer */

// Overlays render into <body> so animated/transformed ancestors (which create stacking contexts) can't trap them
// beneath the sticky header.
export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="animate-fade fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]" role="dialog" aria-modal aria-label={label}
      onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="animate-pop w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-lg)]" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="animate-fade fixed inset-0 z-40 flex justify-end bg-ink/30 backdrop-blur-[1px]" onClick={onClose} role="dialog" aria-modal aria-label={label}
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <aside className="animate-drawer scroll-quiet h-full w-full max-w-xl overflow-auto border-l border-line bg-paper shadow-[var(--shadow-lg)]" onClick={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

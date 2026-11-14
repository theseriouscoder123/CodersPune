import type { Status } from "@/lib/api";

/* Status icons (paths copied from the design export). Statuses differ by SHAPE as well as colour:
 * verified = solid circle + check · supported = ring + dot · inferred = dashed ring · conflicting = triangle + "!"
 * missing = dashed ring + "?" · rejected = ring + x. They accept className so they can stand in for lucide icons. */

type IconProps = { className?: string; size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" | "false" };

function box(size: number | undefined, className: string | undefined) {
  return { width: size ?? 14, height: size ?? 14, viewBox: "0 0 14 14", className: `shrink-0 ${className ?? ""}`, "aria-hidden": true as const };
}

export function VerifiedIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <circle cx="7" cy="7" r="6" fill="var(--ver)" />
      <path d="M4.4 7.2l1.7 1.7 3.5-3.6" stroke="var(--bg)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function SupportedIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--ver)" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="2.4" fill="var(--ver)" />
    </svg>
  );
}
export function InferredIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--inf)" strokeWidth="1.5" strokeDasharray="2.2 1.8" />
    </svg>
  );
}
export function ConflictingIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <path d="M7 1.4c.4 0 .7.2.9.5l5.2 9.1c.4.7-.1 1.6-.9 1.6H1.8c-.8 0-1.3-.9-.9-1.6L6.1 1.9c.2-.3.5-.5.9-.5z" fill="var(--con)" />
      <path d="M7 5v3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="10.1" r=".85" fill="#fff" />
    </svg>
  );
}
export function MissingIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--mis)" strokeWidth="1.5" strokeDasharray="2.2 1.8" />
      <path d="M5.6 5.6a1.5 1.5 0 1 1 2.1 1.4c-.4.2-.7.5-.7.9v.3" stroke="var(--mis)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <circle cx="7" cy="9.9" r=".8" fill="var(--mis)" />
    </svg>
  );
}
export function RejectedIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--fg-4)" strokeWidth="1.5" />
      <path d="M5 5l4 4M9 5l-4 4" stroke="var(--fg-3)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
/** Pending rule check: an empty dashed ring in the muted colour. */
export function PendingIcon({ size, className }: IconProps) {
  return (
    <svg {...box(size, className)}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--fg-4)" strokeWidth="1.5" strokeDasharray="2.2 1.8" />
    </svg>
  );
}
/** Passed rule check: solid green circle with a check (same as verified). */
export const PassIcon = VerifiedIcon;

export const STATUS_META: Record<Status, { label: string; chip: string; dot: string; soft: string; text: string; Icon: (p: IconProps) => React.ReactElement }> = {
  verified: { label: "Verified", chip: "bg-ver-soft text-ver", dot: "bg-ver", soft: "bg-ver-soft", text: "text-ver", Icon: VerifiedIcon },
  supported: { label: "Supported", chip: "bg-ver-soft text-ver", dot: "bg-ver", soft: "bg-ver-soft", text: "text-ver", Icon: SupportedIcon },
  inferred: { label: "Inferred", chip: "bg-bg-sunk text-inf", dot: "bg-inf", soft: "bg-bg-sunk", text: "text-inf", Icon: InferredIcon },
  conflicting: { label: "Conflicting", chip: "bg-con-soft text-con", dot: "bg-con", soft: "bg-con-soft", text: "text-con", Icon: ConflictingIcon },
  missing: { label: "Missing", chip: "bg-mis-soft text-mis", dot: "bg-mis", soft: "bg-mis-soft", text: "text-mis", Icon: MissingIcon },
  rejected: { label: "Rejected", chip: "bg-bg-sunk text-fg-3", dot: "bg-fg-4", soft: "bg-bg-sunk", text: "text-fg-3", Icon: RejectedIcon },
};

/** Legacy maps kept for older imports. */
export const STATUS_STYLE = Object.fromEntries(Object.entries(STATUS_META).map(([k, v]) => [k, v.chip])) as Record<Status, string>;

export const STATUS_HELP: Record<Status, string> = {
  verified: "Evidence passed the checks and a person confirmed it",
  supported: "Quote found in the source and a separate check agrees. Not yet confirmed by a person",
  inferred: "No quote passed the checks. Never shown to the successor as fact",
  conflicting: "Sources disagree. A person must decide",
  missing: "A successor needs this, but no source covers it",
  rejected: "Rejected by the reviewer",
};

export const STATUS_ORDER: Status[] = ["verified", "supported", "inferred", "conflicting", "missing"];

export function StatusIcon({ status, size = 14, className = "" }: { status: Status; size?: number; className?: string }) {
  const Icon = STATUS_META[status].Icon;
  return <Icon size={size} className={className} />;
}

/** sm (default): icon + label in the status colour, used in rows. md: a 22px status pill, used in the inspector header.
 *  A reviewer-promoted claim keeps the Supported shape and says so in words; it is never shown as plain fact. */
export function StatusChip({ status, promoted = false, size = "sm", iconOnly = false }: { status: Status; promoted?: boolean; size?: "sm" | "md"; iconOnly?: boolean }) {
  const m = STATUS_META[status];
  const label = promoted ? "Reviewer-confirmed, no source evidence" : m.label;
  const Icon = promoted ? SupportedIcon : m.Icon;
  if (iconOnly) {
    return <span className="inline-flex shrink-0" title={label} aria-label={label} role="img"><Icon size={14} /></span>;
  }
  if (size === "md") {
    return (
      <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold ${m.chip}`} title={promoted ? label : STATUS_HELP[status]}>
        <Icon size={12} /> {label}
      </span>
    );
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-medium ${m.text}`} title={promoted ? label : STATUS_HELP[status]}>
      <Icon size={12} /> {label}
    </span>
  );
}

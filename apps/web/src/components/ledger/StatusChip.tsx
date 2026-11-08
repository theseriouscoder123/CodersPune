import type { Status } from "@/lib/api";

export const STATUS_STYLE: Record<Status, string> = {
  verified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  supported: "bg-blue-50 text-blue-800 ring-blue-200",
  inferred: "bg-zinc-100 text-zinc-700 ring-zinc-300",
  conflicting: "bg-orange-50 text-orange-800 ring-orange-200",
  missing: "bg-rose-50 text-rose-800 ring-rose-200",
  rejected: "bg-zinc-50 text-zinc-500 ring-zinc-200 line-through",
};

export const STATUS_HELP: Record<Status, string> = {
  verified: "Evidence passed the checks and a person confirmed it",
  supported: "Quote found in the source and a separate check agrees; not yet confirmed by a person",
  inferred: "No quote passed the checks. Never shown to the successor as fact",
  conflicting: "Sources disagree. A person must decide",
  missing: "Something a successor needs, but no source covers it",
  rejected: "Rejected by the reviewer",
};

export const STATUS_ORDER: Status[] = ["verified", "supported", "inferred", "conflicting", "missing"];

export function StatusChip({ status, promoted = false }: { status: Status; promoted?: boolean }) {
  const label = promoted ? "Reviewer-confirmed" : status;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ${STATUS_STYLE[status]}`}
      title={promoted ? "Reviewer-confirmed (no source evidence)" : STATUS_HELP[status]}
    >
      {label}
    </span>
  );
}

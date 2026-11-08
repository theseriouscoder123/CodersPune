import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, ShieldCheck, XCircle } from "lucide-react";

import type { Status } from "@/lib/api";

export const STATUS_META: Record<Status, { label: string; chip: string; dot: string; soft: string; text: string; Icon: typeof CheckCircle2 }> = {
  verified: { label: "Verified", chip: "bg-verified-soft text-verified ring-verified/25", dot: "bg-verified", soft: "bg-verified-soft", text: "text-verified", Icon: ShieldCheck },
  supported: { label: "Supported", chip: "bg-supported-soft text-supported ring-supported/25", dot: "bg-supported", soft: "bg-supported-soft", text: "text-supported", Icon: CheckCircle2 },
  inferred: { label: "Inferred", chip: "bg-inferred-soft text-inferred ring-inferred/25", dot: "bg-inferred", soft: "bg-inferred-soft", text: "text-inferred", Icon: CircleDashed },
  conflicting: { label: "Conflicting", chip: "bg-conflicting-soft text-conflicting ring-conflicting/25", dot: "bg-conflicting", soft: "bg-conflicting-soft", text: "text-conflicting", Icon: AlertTriangle },
  missing: { label: "Missing", chip: "bg-missing-soft text-missing ring-missing/25", dot: "bg-missing", soft: "bg-missing-soft", text: "text-missing", Icon: HelpCircle },
  rejected: { label: "Rejected", chip: "bg-paper-2 text-muted ring-line line-through", dot: "bg-muted", soft: "bg-paper-2", text: "text-muted", Icon: XCircle },
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

export function StatusChip({ status, promoted = false, size = "sm" }: { status: Status; promoted?: boolean; size?: "sm" | "md" }) {
  const m = STATUS_META[status];
  const Icon = promoted ? ShieldCheck : m.Icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-semibold ring-1 ${m.chip} ${size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-[3px] text-[11px]"}`}
      title={promoted ? "Reviewer-confirmed (no source evidence)" : STATUS_HELP[status]}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={2.4} aria-hidden />
      {promoted ? "Reviewer-confirmed" : m.label}
    </span>
  );
}

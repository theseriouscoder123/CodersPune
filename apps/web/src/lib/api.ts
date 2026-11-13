// Same-origin API client. The persona header is validated server-side against memberships; the client never
// decides what a persona may see.

export type Member = { id: string; name: string; handle: string; color: string | null; roles: string[] };
export type WorkspaceInfo = {
  id: string;
  name: string;
  synthetic: boolean;
  read_only: boolean;
  identity_mode?: "switcher" | "invites";
  persona_locked?: boolean;
  is_owner?: boolean;
  members: Member[];
  persona: { id: string; name: string; roles: string[] };
};
export type SourceItem = { kind: string; label: string; count: number };
export type SourceInfo = {
  id: string;
  type: "github_repo" | "upload" | "chat_export" | "testimony" | "fixture";
  name: string;
  uri: string | null;
  access: string;
  restricted: boolean;
  chunk_count: number;
  items: SourceItem[];
  files: string[] | null;
  redactions: number;
  scrub_report: Record<string, number>;
  synthetic: boolean;
  ingested_at: string | null;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const personaKey = (workspaceId: string) => `baton:persona:${workspaceId}`;

export function getStoredPersona(workspaceId: string): string | null {
  try {
    return localStorage.getItem(personaKey(workspaceId));
  } catch {
    return null;
  }
}

export function storePersona(workspaceId: string, memberId: string) {
  try {
    localStorage.setItem(personaKey(workspaceId), memberId);
  } catch {
    /* private mode: persona falls back to the server default */
  }
}

export async function api<T>(path: string, opts: { workspaceId?: string; method?: string; body?: unknown; persona?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  // Reads pass the persona the screen is rendered for, so a persona switch can't fire the old screen's requests as
  // the new persona (which the server would rightly refuse with 403).
  const persona = opts.persona ?? (opts.workspaceId ? getStoredPersona(opts.workspaceId) : null);
  if (persona) headers["X-Baton-Persona"] = persona;
  const method = opts.method ?? "GET";
  const isRead = method === "GET";
  let res: Response | null = null;
  // Reads are abandoned after 20 s and retried once: a single stalled serverless instance then costs seconds, not a
  // minute. Writes are never retried automatically (they might have been applied).
  for (let attempt = 0; attempt < (isRead ? 2 : 1); attempt++) {
    const ctrl = new AbortController();
    const timer = isRead ? setTimeout(() => ctrl.abort(), 20_000) : undefined;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        credentials: "same-origin",
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!(isRead && res.status >= 502 && res.status <= 504 && attempt === 0)) break;
    } catch {
      if (attempt === (isRead ? 1 : 0)) throw new ApiError(0, "Can't reach Baton right now. Check your connection and try again.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (!res) throw new ApiError(0, "Can't reach Baton right now. Check your connection and try again.");
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") detail = j.detail;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) detail = `Please check the form: ${j.detail[0].msg}`;
    } catch {
      /* non-JSON error (e.g. a gateway timeout page) */
    }
    if (!detail) {
      const ref = res.headers.get("x-request-id");
      detail = res.status >= 500
        ? `The server had a problem (${res.status}). Please try again in a moment${ref ? ` · reference ${ref}` : ""}.`
        : `Request failed (${res.status}).`;
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export type Status = "verified" | "supported" | "inferred" | "conflicting" | "missing" | "rejected";

export type ClaimSummary = {
  id: string;
  type: string;
  type_label: string;
  text: string;
  status: Status;
  status_reason: string;
  origin: "extracted" | "checklist" | "testimony";
  review_state: string;
  subject_key: string;
  value: string | null;
  stated: boolean;
  occurred_at: string | null;
  superseded_by: string | null;
  superseded_by_text?: string | null;
  conflict_group_id: string | null;
  reviewer_note: string | null;
  source_refs: string[];
  flags: { reviewer_confirmed_without_evidence?: boolean; source_changed?: boolean };
  question: string | null;
  source_changed?: { at: string; source: string; where: string; note: string } | null;
  needs_rereview?: boolean;
};

export type EvidenceInfo = {
  id: string;
  quote: string;
  quote_found: boolean;
  match_score: number;
  verdict: string;
  verdict_reason: string | null;
  verifier: string | null;
  ref: string;
  source: { id: string; name: string; type: string; access: string };
  location: Record<string, unknown>;
  kind: string;
  author: string | null;
  occurred_at: string | null;
  excerpt: { before: string; match: string; after: string; truncated_start: boolean; truncated_end: boolean };
};

export type ClaimDetail = ClaimSummary & {
  evidence: EvidenceInfo[];
  conflict?: { id: string; resolved: boolean; resolution: string | null; others: ClaimSummary[] };
  history: { action: string; actor_role: string; note: string | null; at: string }[];
};

export type Ledger = {
  claims: ClaimSummary[];
  status_counts: Partial<Record<Status, number>>;
  type_counts: Record<string, number>;
  tab_counts: { all: number; conflicts: number; missing: number; rejected: number; superseded: number };
  progress?: { reviewed: number; total: number; supported_unconfirmed: number; source_changed?: number };
};

export type RunStep = { step: string; label: string; status: string; progress: number; total: number; message: string | null; errors: string[] };
export type RunInfo = { id: string; status: string; error: string | null; started_at: string | null; finished_at: string | null; steps: RunStep[]; stats: Record<string, unknown> };

export type HandoverRef = { id: string; name: string; leaver: string; successor: string; leaver_id: string; successor_id: string; scope: string; show_restricted_stubs: boolean; latest_version: number | null };

export type HandoverItem = {
  claim_id: string;
  type: string;
  type_label: string;
  text: string;
  status: Status;
  status_reason: string;
  flags: { reviewer_confirmed_without_evidence?: boolean };
  occurred_at: string | null;
  history?: boolean;
  superseded_by_text?: string | null;
  restricted?: boolean;
  evidence: { evidence_id: string; chunk_id: string; ref: string }[];
};

export type HandoverView =
  | { approved: false; leaver: string; successor: string; message: string }
  | {
      approved: true;
      leaver: string;
      successor: string;
      handover_id: string;
      version: number;
      approved_at: string;
      approved_by: string | null;
      note: string | null;
      sections: { key: string; title: string; help: string; items: HandoverItem[] }[];
      withheld_count: number | null;
    };

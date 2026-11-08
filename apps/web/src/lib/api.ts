// Same-origin API client. The persona header is validated server-side against memberships; the client never
// decides what a persona may see.

export type Member = { id: string; name: string; handle: string; color: string | null; roles: string[] };
export type WorkspaceInfo = {
  id: string;
  name: string;
  synthetic: boolean;
  read_only: boolean;
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

export async function api<T>(path: string, opts: { workspaceId?: string; method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const persona = opts.workspaceId ? getStoredPersona(opts.workspaceId) : null;
  if (persona) headers["X-Baton-Persona"] = persona;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : detail;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

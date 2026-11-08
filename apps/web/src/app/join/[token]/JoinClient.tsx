"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/Logo";
import { ButtonLink, Spinner } from "@/components/ui";
import { api, storePersona } from "@/lib/api";

export function JoinClient() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; name?: string }>({});
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<{ workspace_id: string; workspace: string; member_id: string; member: string }>(`/join/${token}`, { method: "POST" })
      .then((r) => {
        storePersona(r.workspace_id, r.member_id);
        setState({ name: r.member });
        setTimeout(() => router.replace(`/w/${r.workspace_id}/handover`), 900);
      })
      .catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
  }, [token, router]);

  return (
    <div className="paper-grain flex flex-1 flex-col items-center justify-center px-5">
      <div className="animate-pop w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-[var(--shadow-md)]">
        <div className="flex justify-center"><Logo /></div>
        {state.error ? (
          <>
            <p className="font-display mt-6 text-xl font-semibold text-ink">This link doesn&apos;t work</p>
            <p className="mt-2 text-sm text-muted">{state.error}</p>
            <ButtonLink href="/" variant="secondary" className="mt-6">Go to the start page</ButtonLink>
          </>
        ) : state.name ? (
          <>
            <p className="font-display mt-6 text-xl font-semibold text-ink">Welcome, {state.name}</p>
            <p className="mt-2 text-sm text-muted">Taking you to your handover…</p>
          </>
        ) : (
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted"><Spinner /> Checking your invite…</p>
        )}
      </div>
    </div>
  );
}

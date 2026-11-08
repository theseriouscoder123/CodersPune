import { Suspense } from "react";

import { WorkspaceShellFromParams } from "@/components/workspace/WorkspaceShellFromParams";

// Cache Components: route-param hooks must sit under <Suspense> for dynamic segments (see Next 16 docs,
// "migrating-to-cache-components"). The whole workspace UI is client-fetched under the acting persona.
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted">Opening workspace…</div>}>
      <WorkspaceShellFromParams>{children}</WorkspaceShellFromParams>
    </Suspense>
  );
}

import { Suspense } from "react";

import { WorkspaceShellFromParams } from "@/components/workspace/WorkspaceShellFromParams";

// Cache Components: route-param hooks must sit under <Suspense> for dynamic segments (see Next 16 docs,
// "migrating-to-cache-components"). The whole workspace UI is client-fetched under the acting persona.
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted">Loading workspace…</div>}>
      <WorkspaceShellFromParams>{children}</WorkspaceShellFromParams>
    </Suspense>
  );
}

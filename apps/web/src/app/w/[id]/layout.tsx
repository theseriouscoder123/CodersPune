import { Suspense } from "react";

import { WorkspaceShellFromParams } from "@/components/workspace/WorkspaceShellFromParams";

// Cache Components: route-param hooks must sit under <Suspense> for dynamic segments (see Next 16 docs,
// "migrating-to-cache-components"). The whole workspace UI is client-fetched under the acting persona.
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted">
        <span>Opening workspace…</span>
        {/* Pure CSS (no JS needed): if the app's scripts never load, e.g. mid-deploy, offer a way out after 8 s. */}
        <a href="" className="reveal-late rounded-lg px-3 py-1.5 text-xs font-medium text-ink underline underline-offset-2">Taking a while? Reload the page</a>
      </div>
    }>
      <WorkspaceShellFromParams>{children}</WorkspaceShellFromParams>
    </Suspense>
  );
}

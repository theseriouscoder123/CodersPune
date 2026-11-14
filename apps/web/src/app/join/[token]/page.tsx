import { Suspense } from "react";

import { JoinClient } from "./JoinClient";

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-fg-3">Opening your invite…</div>}>
      <JoinClient />
    </Suspense>
  );
}

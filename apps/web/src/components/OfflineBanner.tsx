"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** A thin banner while the browser is offline, so failed actions have an obvious cause. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="no-print sticky top-0 z-50 flex items-center justify-center gap-2 bg-missing px-4 py-2 text-sm font-medium text-white">
      <WifiOff className="h-4 w-4" /> You&apos;re offline. Changes can&apos;t be saved until the connection is back.
    </div>
  );
}

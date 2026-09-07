import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Sheet } from "../ui/Sheet";
import { discardPendingWrite, retryPendingWrite, usePendingWrites } from "./pendingWrites";
import "./OfflineBanner.css";

const submittedTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Global status for connectivity and unresolved writes. */
export function OfflineBanner() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const writes = usePendingWrites(online);
  if (online && writes.length === 0) return null;
  const errors = writes.filter((write) => write.status === "Needs attention").length;
  const waiting = writes.some((write) => write.status === "Waiting to send");
  const count = errors || writes.length;
  const label = errors > 0
    ? `${count} ${count === 1 ? "change" : "changes"} needs attention`
    : `${count} ${count === 1 ? "change" : "changes"} ${online ? waiting ? "waiting to send" : "syncing" : "waiting to sync"}`;
  async function retry(id: number) {
    if (retryingId !== null) return;
    setRetryingId(id);
    try { await retryPendingWrite(client, id); } catch { /* mutation state shows failure */ }
    finally { setRetryingId(null); }
  }
  function discard(id: number) {
    if (window.confirm("Discard this unsent change?")) discardPendingWrite(client, id);
  }
  return <>
    <div className="offline" role="status">
      {writes.length > 0
        ? <button className="offline__open" onClick={() => setOpen(true)} aria-label={label}>{label}</button>
        : "Offline. Changes will sync when you're back."}
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title="Sync activity">
      <div className="sync-list">
        {writes.map((write) => <article className="sync-row" key={write.id}>
          <div><strong>{write.action}</strong><span>{write.detail}</span><small>Submitted {submittedTime.format(write.submittedAt)}</small></div>
          <div className="sync-row__state">
            <span className="sync-row__status">{write.status}</span>
            {write.retryable && <button className="sync-row__retry" disabled={retryingId !== null} onClick={() => retry(write.id)} aria-label={`Retry ${write.action}`}>Retry</button>}
            {write.status === "Needs attention" && !write.blocked && !write.retryable && <a className="sync-row__recover" href={write.recoveryHref} onClick={() => setOpen(false)}>{write.recoveryLabel}</a>}
            {write.blocked && !write.retryable && <small>Resolve earlier change first</small>}
            {write.status === "Needs attention" && <button className="sync-row__discard" onClick={() => discard(write.id)} aria-label={`Discard ${write.action}`}>Discard</button>}
          </div>
        </article>)}
      </div>
    </Sheet>
  </>;
}

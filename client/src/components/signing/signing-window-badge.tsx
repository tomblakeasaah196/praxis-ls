/**
 * "Signing unlocked · 4:12 · End now" — the 5-minute signing window, shown
 * while it is open (meeting 6, F6).
 *
 * Lives in the shell's top bar because the window belongs to the SESSION:
 * approving a costing on one screen and a cash request on the next both sign
 * under it. It counts down to the server's `expires_at` and never past it —
 * use does not extend the window — and "End now" closes it on the server.
 * Nothing renders when no window is open.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as signingWindow from "@/lib/signing-window";

function mmss(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SigningWindowBadge() {
  const w = signingWindow.useSigningWindow();
  const [left, setLeft] = React.useState(() => signingWindow.remainingMs());
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (!w) return;
    const tick = () => {
      const ms = signingWindow.remainingMs();
      setLeft(ms);
      // Its five minutes are up: the server has closed it, so drop it here.
      if (ms <= 0) signingWindow.clear();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [w]);

  if (!w || left <= 0) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok-fill/10 py-0.5 pl-2.5 pr-1 text-xs text-foreground"
    >
      <span className="font-medium">{tr("Signing unlocked")}</span>
      <span aria-hidden>·</span>
      <span className="num" aria-label={tr("Time left")}>
        {mmss(left)}
      </span>
      <span aria-hidden>·</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon={null}
        className="h-6 px-2 text-xs"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signingWindow.end();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr("End now")}
      </Button>
    </span>
  );
}

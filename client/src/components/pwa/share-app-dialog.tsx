/**
 * "Share the app" from the account menu (tenant review of 29 Sep 2026, item
 * 1.9): the workspace's own address, to copy, to send on WhatsApp, or to scan
 * from the QR on this screen — so a colleague can install the app without
 * anyone having to explain where it lives. The person receiving it signs in
 * with their own account; the link carries nothing but the address.
 */
import { tr, tv } from "@/lib/i18n";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

function shareAppText(url: string, name: string): string {
  return tv("Install {{name}} on your phone: {{url}} — open it in Chrome (Android) or Safari (iPhone), sign in, then add it to your home screen.", { name, url });
}

export function ShareAppDialog({ open, onClose, appName }: { open: boolean; onClose: () => void; appName: string }) {
  const toast = useToast();
  const url = typeof window !== "undefined" ? `${window.location.origin}/` : "/";
  if (!open) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tr("Link copied."));
    } catch {
      toast.error(tr("The link could not be copied — select it and copy it yourself."));
    }
  }
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(shareAppText(url, appName))}`;
  return (
    <Modal open onClose={onClose} title={tr("Share the app")} description={tr("Send a colleague the link, or let them scan the code. They sign in with their own account.")}>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="grid gap-3">
          <Input value={url} readOnly aria-label={tr("App link")} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              {tr("Copy link")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.open(whatsapp, "_blank", "noopener,noreferrer")}>
              {tr("Send on WhatsApp")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("On a phone, it must open in Chrome or Safari — a link opened inside WhatsApp cannot install the app.")}
          </p>
        </div>
        <figure className="justify-self-center rounded-lg border bg-card p-2">
          <img src="/install-qr.svg" alt={tr("QR code of the app's address")} width={160} height={160} className="h-40 w-40" />
          <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">{tr("Scan to open")}</figcaption>
        </figure>
      </div>
    </Modal>
  );
}

/**
 * "Send by email" on a team message, and what each team message's email did
 * (tenant review of 29 Sep 2026, PR 1, owner decision D8).
 *
 *   SendByEmailDialog  the client's portal users who can see the conversation,
 *                      pre-ticked and editable, then ONE send: the key minted
 *                      when the dialog opens rides every retry, so a double
 *                      click or a retried request sends once. The email is the
 *                      tenant's branded layout with the sender's signature and
 *                      the message's files (portal_notify.emailTeamMessage).
 *   DeliveryLine       under each team message: "Emailed to Elisha Godwin ·
 *                      10:42 · by Tom", "Read in the portal — no email needed",
 *                      or "Not emailed: never signed in" — read from what the
 *                      portal sender already records.
 */
import * as React from "react";
import { clientPortal } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, useResource } from "@/lib/use-resource";
import { dateTimeFmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { deliveryLines, type DeliveryPerson } from "./client-message-delivery";

export type { DeliveryPerson, DeliveryState } from "./client-message-delivery";

type Recipient = { email: string; full_name: string | null; signed_in: boolean; emails_off: boolean };

export function DeliveryLine({ people }: { people: DeliveryPerson[] | undefined | null }) {
  const lines = deliveryLines(people);
  if (!lines.length) return null;
  return (
    <div className="mt-0.5 text-right text-[11px] text-muted-foreground" aria-label={tr("Email delivery")}>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

/** A fresh key per opening of the dialog — every retry of THIS send carries it. */
function mintKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function SendByEmailDialog({
  message,
  onClose,
  onSent,
}: {
  message: { message_id: string; body: string; created_at: string } | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const id = message?.message_id || null;
  const recipients = useResource(
    () => (id ? tenant<{ recipients: Recipient[] }>(`/portal/chat/messages/${id}/recipients`) : Promise.resolve({ recipients: [] })),
    [id],
    { fresh: true },
  );
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useMemo(() => (id ? mintKey() : ""), [id]);
  const list = recipients.data?.recipients || [];

  // Everyone who can see the conversation, pre-ticked.
  React.useEffect(() => {
    setPicked(new Set(list.map((r) => r.email.toLowerCase())));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients.data]);

  if (!message) return null;

  async function send() {
    const body = { recipients: [...picked], request_key: key };
    const ok = clientPortal.messageEmail.safeParse(body);
    if (!ok.success) {
      setError(ok.error.issues[0]?.message || tr("Choose who receives it."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await tenant<{ emailed: string[]; already: string[] }>(`/portal/chat/messages/${message!.message_id}/email`, {
        method: "POST",
        body: ok.data,
      });
      const n = out.emailed.length + out.already.length;
      toast.success(n === 1 ? tr("Emailed.") : tv("Emailed to {{n}} people.", { n }));
      onSent();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Send this message by email")}
      description={tr("Sent now, as a branded email with your signature and its files attached. A reply comes back to you.")}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button loading={busy} disabled={!picked.size || recipients.loading} onClick={() => void send()}>
            {tr("Send email")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <blockquote className="max-h-32 overflow-y-auto rounded-lg border-l-2 border-primary bg-muted px-3 py-2 text-sm text-foreground">
          <p className="whitespace-pre-wrap break-words">{message.body || tr("(a file or a location)")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{dateTimeFmt(message.created_at)}</p>
        </blockquote>
        {recipients.loading ? <LoadingRow /> : null}
        {recipients.error ? <ErrorState message={recipients.error} /> : null}
        {!recipients.loading && !list.length && !recipients.error ? (
          <p className="text-sm text-muted-foreground">{tr("Nobody at the client can see this conversation yet — give them portal access first.")}</p>
        ) : null}
        <ul className="grid gap-2" aria-label={tr("Recipients")}>
          {list.map((r) => {
            const k = r.email.toLowerCase();
            const notes = [
              !r.signed_in ? tr("has not signed in yet") : null,
              r.emails_off ? tr("switched message emails off — this one still goes") : null,
            ].filter(Boolean) as string[];
            return (
              <li key={k}>
                <Checkbox
                  checked={picked.has(k)}
                  onCheckedChange={(on) =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (on) next.add(k);
                      else next.delete(k);
                      return next;
                    })
                  }
                  label={r.full_name ? `${r.full_name} · ${r.email}` : r.email}
                  hint={notes.length ? notes.join(" · ") : undefined}
                />
              </li>
            );
          })}
        </ul>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}

/**
 * Comms → Setup → Company Mail → Sending Addresses (administrators).
 *
 * Which address each part of the product sends from.
 *
 * ── ONE ADDRESS PER SECTION, AND NOTHING TO DO IF YOU WANT THE DEFAULT ──────
 *
 * This was a tab of its own listing every send point in the product, about
 * twenty rows each with a sentence of explanation, a source pill and a Change
 * button, under a paragraph explaining the fallback chain. The tenant's
 * instruction (16 Nov 2026) was to simplify it to the max: "set up one per
 * section, and if nothing is set up it uses the system's default", all on the
 * same page, "but we can still individually change each line".
 *
 * So the screen is eight rows, one per section. Each shows the address it
 * sends from and one Change button, which sets every line in that section at
 * once. A section that has never been touched shows the default address and
 * needs nothing done to it. The individual lines are behind the row's
 * disclosure, each with its own address and its own Change.
 *
 * ── WHAT "DEFAULT" IS ───────────────────────────────────────────────────────
 *
 * Whatever the server resolves for a line with no binding: the section sender
 * if one exists, then the company's shared SMTP login (the section below this
 * one), then the Praxis system sender. The address shown is the one the server
 * returned (`resolved.from_address`), not one this screen worked out, so the
 * row and the mail that actually goes out cannot disagree.
 *
 * ── LINES NOTHING SENDS THROUGH YET ARE NOT DRAWN ───────────────────────────
 *
 * Some send points are declared for a module that does not mail yet. They used
 * to be listed with a "not used yet" pill. They are still SET when a section
 * is changed, so they are already right the day that part ships; they are just
 * not rows anybody has to read.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Modal, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { Panel } from "@/components/ui/panel";
import { ChevronIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useResource, errMsg } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { tr, tv } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

const GROUP_LABEL: Record<string, string> = {
  FINANCE: "Finance",
  SALES: "Sales & Commercial",
  OPERATIONS: "Operations",
  PROCUREMENT: "Procurement",
  HR: "People",
  SECURITY: "Sign-In & Security",
  DOCUMENTS: "Documents",
  SYSTEM: "System",
};

const isDefault = (p: api.SendPoint) => p.resolved.source === "FALLBACK";

/** What a section sends from: one address, or the fact that its lines differ. */
function sectionAddress(lines: api.SendPoint[]): { address: string | null; mixed: boolean; isDefault: boolean } {
  const addresses = Array.from(new Set(lines.map((l) => l.resolved.from_address || "")));
  return {
    address: addresses.length === 1 ? addresses[0] || null : null,
    mixed: addresses.length > 1,
    isDefault: lines.every(isDefault),
  };
}

/** The address a row sends from, or what stands in for it. */
function Address({ address, mixed, fallback }: { address: string | null; mixed?: boolean; fallback: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="num truncate text-sm text-muted-foreground">
        {mixed ? tr("Several addresses") : address || tr("Default address")}
      </span>
      {fallback && !mixed && address && <Pill tone="mute">{tr("Default")}</Pill>}
    </span>
  );
}

/**
 * One picker for both scopes: a single line, or every line in a section.
 *
 * `points` is what Save writes to. One entry is a line; several is a section,
 * and the dialog says how many lines it is about to set, because setting a
 * section replaces whatever its lines were individually set to.
 */
function BindModal({
  title, points, senders, mailboxes, onClose, onDone,
}: {
  title: string;
  points: api.SendPoint[];
  senders: api.Sender[];
  mailboxes: api.Mailbox[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [choice, setChoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  /* Only a CONNECTED mailbox can actually send, the same rule the compose
   * dialog's From picker applies. Offering a disconnected, broken or retired
   * address here routes a send point at a sender whose mail will fail at the
   * flush, hours after the choice looked fine. */
  const sendable = mailboxes.filter((m) => m.status === "CONNECTED");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const [kind, id] = choice.split(":");
      // One at a time: the endpoint is per line, and a section that half
      // applied should stop at the line that refused rather than race past it.
      for (const point of points) {
        if (!choice) {
          await api.unbindSendPoint(point.send_point_key);
        } else {
          await api.bindSendPoint(point.send_point_key, {
            email_identity_id: kind === "identity" ? id : null,
            email_connection_id: kind === "mailbox" ? id : null,
          });
        }
      }
      onDone(); onClose();
    } catch (err) { setError(err); reportActionError(err); onDone(); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label={tr("Send From")}>
          <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr("Default address")}</option>
            {senders.length > 0 && (
              <optgroup label={tr("System Senders")}>
                {senders.map((s) => (
                  <option key={s.email_identity_id} value={`identity:${s.email_identity_id}`}>
                    {s.from_address}
                  </option>
                ))}
              </optgroup>
            )}
            {sendable.length > 0 && (
              <optgroup label={tr("Shared Mailboxes")}>
                {sendable.map((m) => (
                  <option key={m.email_connection_id} value={`mailbox:${m.email_connection_id}`}>
                    {m.email_address}
                    {m.catalogue_label ? ` (${m.catalogue_label})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {points.length > 1 && (
          // The consequence, said where it is committed: a section replaces
          // what its lines were individually set to.
          <p className="hint">
            {tv("Applies to all {{count}} lines in this section.", { count: points.length })}
          </p>
        )}
        {error != null && <ErrorState message={errMsg(error)} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" loading={busy} disabled={busy}>{tr("Save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SendPointsSection() {
  const points = useResource(() => api.listSendPoints(), []);
  const senders = useResource(() => api.listSenders(), []);
  const mailboxes = useResource(() => api.allMailboxes({ kind: "SHARED" }), []);
  const [editing, setEditing] = React.useState<{ title: string; points: api.SendPoint[] } | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  const rows = points.data || [];
  const groups = Array.from(new Set(rows.map((r) => r.group_key)));

  return (
    <Panel title={tr("Sending Addresses")}>
      {points.error && <ErrorState message={points.error} />}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {groups.map((g) => {
          const all = rows.filter((r) => r.group_key === g);
          // What a person can see being sent. A section with no line in use
          // yet still gets its row, so it can be set ahead of time.
          const lines = all.filter((r) => r.is_wired);
          const label = GROUP_LABEL[g] ? tr(GROUP_LABEL[g]) : g;
          const summary = sectionAddress(lines.length ? lines : all);
          const isOpen = open === g;
          const panelId = `send-points-${g}`;
          return (
            <li key={g}>
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : g)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  disabled={lines.length === 0}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                >
                  <ChevronIcon
                    width={14}
                    height={14}
                    className={cn(
                      "shrink-0 text-muted-foreground transition-transform duration-150",
                      !isOpen && "-rotate-90",
                      lines.length === 0 && "opacity-0",
                    )}
                  />
                  <span className="text-sm font-medium">{label}</span>
                </button>
                <Address address={summary.address} mixed={summary.mixed} fallback={summary.isDefault} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${tr("Change")} ${label}`}
                  onClick={() => setEditing({ title: label, points: all })}
                >
                  {tr("Change")}
                </Button>
              </div>
              {isOpen && (
                <ul id={panelId} className="border-t border-border bg-card/40">
                  {lines.map((r) => (
                    <li key={r.send_point_key} className="flex flex-wrap items-center gap-3 py-2 pl-9 pr-3">
                      <span className="min-w-0 flex-1 truncate text-sm">{r.label_en}</span>
                      <Address address={r.resolved.from_address || null} fallback={isDefault(r)} />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`${tr("Change")} ${r.label_en}`}
                        onClick={() => setEditing({ title: r.label_en, points: [r] })}
                      >
                        {tr("Change")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {editing && (
        <BindModal
          title={editing.title}
          points={editing.points}
          senders={senders.data || []}
          mailboxes={mailboxes.data || []}
          onClose={() => setEditing(null)}
          onDone={() => points.reload()}
        />
      )}
    </Panel>
  );
}

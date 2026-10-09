/**
 * God Mode — the CEO-only, PIN-gated purge console (MOD-00B / PRD §8.5). Lists
 * soft-deleted junk records and permanently purges them, writing the full removed
 * payload to the immutable ledger. Accounting-connected records can NEVER be
 * purged (reverse instead) — the backend refuses them. Server enforces CEO + PIN.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { RowActions } from "@/components/ui/row-actions";
import { useList, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";

type SoftDelete = {
  soft_delete_id: string;
  entity_ref: string;
  table_name?: string | null;
  deleted_by?: string | null;
  deleted_at?: string | null;
  is_accounting_connected?: boolean | null;
};

function PurgeModal({
  row,
  onClose,
  onPurged,
}: {
  row: SoftDelete;
  onClose: () => void;
  onPurged: () => void;
}) {
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/god-mode/purge", {
        method: "POST",
        body: { soft_delete_id: row.soft_delete_id, pin },
      });
      onPurged();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Purge Record">
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-lg border border-bad/40 bg-bad-fill/10 px-3 py-2 text-sm">
          <span className="num font-medium">{row.entity_ref}</span>
        </div>
        {/* WHAT THIS DESTROYS, AT THE POINT OF COMMIT.
         *
         * This was the Modal's `description`, which renders behind the ⓘ on the
         * title. §3.17's ladder puts explanation there and this is not
         * explanation: it is the sentence that tells the CEO the record is gone
         * for good, two inches above the button that does it. Nobody hovers
         * before they act, so it is printed. @prose:keep — a destructive
         * consequence at the moment of commit. */}
        <Callout tone="bad" title="This Cannot Be Undone">
          The record is removed for good. Its full payload is written to the
          immutable ledger, where this purge stays on the record.
        </Callout>
        <Field label="God Mode PIN" required>
          <Input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="CEO PIN"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!pin || busy}>
            Purge permanently
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function GodModePage() {
  const { rows, error, loading, reload } = useList<SoftDelete>(
    "/god-mode/soft-deletes",
  );
  const [target, setTarget] = React.useState<SoftDelete | null>(null);
  const list = rows || [];

  const columns: Column<SoftDelete>[] = [
    {
      key: "entity_ref",
      label: "Record",
      render: (r) => (
        <span className="num font-medium text-foreground">{r.entity_ref}</span>
      ),
    },
    {
      key: "table_name",
      label: "Type",
      render: (r) =>
        r.table_name ? <Pill tone="mute">{r.table_name}</Pill> : "—",
    },
    {
      key: "deleted_at",
      label: "Soft-deleted",
      render: (r) => dateFmt(r.deleted_at),
    },
    {
      key: "connected",
      label: "Ledger",
      render: (r) =>
        r.is_accounting_connected ? (
          <Pill tone="bad">Protected</Pill>
        ) : (
          <Pill tone="ok">Purgeable</Pill>
        ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button
            size="sm"
            variant="outline"
            disabled={!!r.is_accounting_connected}
            onClick={() => setTarget(r)}
          >
            Purge
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="God Mode"
        description="Permanently removes soft-deleted junk data. The CEO's PIN is required for every purge."
      />
      {/* THE ONE WARNING THIS SCREEN PRINTS.
        *
        * It used to print two: this band, and a PageHeader description carrying
        * the same three facts behind the ⓘ. The header now says what the screen
        * is FOR, which is what belongs behind an ⓘ, and the consequences stay
        * here, visible, in the destructive tone. @prose:keep — what a purge
        * destroys and what it records, on the screen that does it. */}
      <Callout tone="bad" title="Permanent, and Recorded">
        A purge cannot be reversed, and every one is written to the audit trail
        under the name that ran it. Records connected to accounting are refused:
        reverse those instead.
      </Callout>
      <div className="mb-4" />
      <KpiRow>
        <KpiTile label="Soft-deleted" value={num(list.length)} />
        <KpiTile
          label="Purgeable"
          value={num(list.filter((r) => !r.is_accounting_connected).length)}
        />
        <KpiTile
          label="Ledger-protected"
          value={num(list.filter((r) => r.is_accounting_connected).length)}
        />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.soft_delete_id}
        empty={{ title: "Nothing to purge" }}
      />
      {target && (
        <PurgeModal
          row={target}
          onClose={() => setTarget(null)}
          onPurged={reload}
        />
      )}
    </section>
  );
}

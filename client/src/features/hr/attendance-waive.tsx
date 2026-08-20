/**
 * Waiving a reconciled day.
 *
 * ── WHAT THIS FILE IS NOW ───────────────────────────────────────────────────
 *
 * It used to hold `AttendanceDaysView`, the HR "reconciled days" table. PR2
 * replaced that with the shared `attendance-history` widget, which answers the
 * same question over the same window and adds the KPI strip, the heatmap and
 * the payroll export — and, crucially, gives My HR, the HR command centre and
 * Employee 360 ONE implementation instead of three that can disagree.
 *
 * What survived is the part that moves money, which must exist exactly once.
 * The status palette moved to `attendance-status.ts` — Fast Refresh only works
 * on files that export components alone. Deleting the old view rather than
 * leaving it unreachable is deliberate: a second attendance table nobody
 * renders is the thing a later reader would copy from.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import * as api from "@/lib/hr-api";

export function WaiveModal({
  day,
  onClose,
  onSaved,
}: {
  day: api.AttendanceDay;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [why, setWhy] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.justifyDay(day.attendance_day_id, { justified: true, justification: why });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Waive this day"
      description={`${day.employee_name || "This employee"} — ${dateFmt(day.work_date)}`}
    >
      <form className="space-y-4" onSubmit={submit}>
        {/* The figure is kept, not erased — which is what makes the waiver
            reversible and its cost visible. Saying so here stops "waive"
            reading as "delete". */}
        <Callout tone="info" title={`${money(day.deduction_amount)} will not be deducted`}>
          The amount stays on the record so this can be reversed, and so the cost
          of waivers is visible. Payroll ignores waived days.
        </Callout>
        <Field label="Why" required hint="The employee sees this on their own record.">
          <Input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Traffic on the Douala–Bonabéri bridge, confirmed by two colleagues"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!why.trim() || busy}>
            Waive
          </Button>
        </div>
      </form>
    </Modal>
  );
}

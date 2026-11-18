/**
 * Leads & intake — the write surfaces.
 *
 * The lead form the mail conversion landing (`/sales/leads/new`) opens with an
 * email's details filled in. The Leads screens capture through
 * `lead-capture.tsx` and edit, make a client and archive from the 360
 * (`lead-dialogs.tsx`), lean revamp PR 3.
 *
 * TriageModal was removed by F9. The enquiry desk is its own screen now
 * (features/sales/enquiries.tsx), and its Manage drawer owns triage. Leaving it here would
 * have left a second write surface posting the pre-F9 payload at the same
 * endpoint, which is the duplication F9 exists to remove.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { SearchSelect } from "@/components/ui/search-select";
import { lead as leadShape } from "@shared";

/** The source vocabulary is the shared one (CAMPAIGN left with Campaigns). */
const LEAD_SOURCES = leadShape.SOURCES;

/**
 * Tomorrow as a bare day: the API reads it as 09:00 on the tenant's clock.
 * Built from the local calendar, not toISOString(), which is a UTC day.
 */
function tomorrowIsoDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type LeadInitial = {
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  service_interest?: string | null;
};

export function LeadForm({
  open,
  editing,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  /** Seed for a NEW lead (mail conversion). Ignored when `editing` is set. */
  initial?: LeadInitial | null;
  onClose: () => void;
  /** Receives the created lead's id on POST, so callers can link back to it. */
  onSaved: (id?: string | null) => void;
}) {
  const [company, setCompany] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [source, setSource] = React.useState("MANUAL");
  const [interest, setInterest] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const seed = (v: unknown, fb: unknown) =>
      v !== null && v !== undefined && v !== "" ? String(v) : fb !== null && fb !== undefined && fb !== "" ? String(fb) : "";
    setCompany(seed(editing?.company_name, initial?.company_name));
    setContact(seed(editing?.contact_name, initial?.contact_name));
    setEmail(seed(editing?.email, initial?.email));
    setPhone(seed(editing?.phone, initial?.phone));
    setSource(editing?.source ? String(editing.source) : "MANUAL");
    setInterest(seed(editing?.service_interest, initial?.service_interest));
    setError(null);
  }, [open, editing, initial]);

  // A new company needs one way to reach it (lean revamp, D5).
  const canSubmit = !!company.trim() && (!!editing || !!email.trim() || !!phone.trim()) && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      company_name: company.trim(),
      contact_name: contact.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      source,
      service_interest: interest.trim() || undefined,
    };
    try {
      if (editing) {
        await tenant(`/leads/${String(editing.lead_id)}`, {
          method: "PATCH",
          body,
        });
        onSaved(editing.lead_id ? String(editing.lead_id) : null);
      } else {
        // Every open lead has a dated next step (D4): this screen does not ask
        // for one yet (the Leads screens of PR 3 do), so it proposes the
        // capture's default, Call back tomorrow morning.
        const capture = {
          ...body,
          next_step: { action: leadShape.DEFAULT_NEXT_STEP_ACTION, due_at: tomorrowIsoDay() },
        };
        const parsed = leadShape.capture.safeParse(capture);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message || "Check the form");
          return;
        }
        const created = (await tenant("/leads", { method: "POST", body: capture })) as Row | null;
        onSaved(created?.lead_id ? String(created.lead_id) : null);
      }
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit Lead" : "Capture lead"}
      description="Top of the sales funnel — qualify, then convert into a client."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("Company")}
            required
            className="sm:col-span-2"
            hint="Search existing clients, or type a new company"
          >
            <SearchSelect
              path="/clients"
              value={company || null}
              placeholder="Search clients or type a new company…"
              getLabel={(r) => String(r.name ?? "")}
              getKey={(r) => String(r.client_id ?? r.name)}
              onSelect={(r) => setCompany(String(r.name ?? ""))}
              allowFreeText
              onFreeText={(t) => setCompany(t)}
            />
          </Field>
          <Field label="Contact Name">
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={tr("Jane Doe")}
            />
          </Field>
          <Field label="Service Interest" hint="What they're after">
            <Input
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              placeholder="Freight forwarding"
            />
          </Field>
          <Field label={tr("Email")}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.cm"
            />
          </Field>
          <Field label={tr("Phone")}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+237 6XX XXX XXX"
            />
          </Field>
          <Field label={tr("Source")}>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save changes" : "Capture lead"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

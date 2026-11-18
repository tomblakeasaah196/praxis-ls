/**
 * Capture Lead (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, owner decision D5).
 *
 * Two things are asked for: who (a company or a person) and one way to reach
 * them. A next step is proposed (Call back, tomorrow at 09:00) so the row is
 * never open without one (D4). Everything else waits behind More Details.
 *
 * THE DUPLICATE CHECK RUNS AS YOU TYPE. Company, email and phone are each a
 * key; a hit shows "Already here: <name>" with Open It, which closes the dialog
 * on that company and creates nothing. The API refuses the same duplicate on
 * save (409 LEAD_EXISTS), and the refusal lands in the same banner, so a race
 * between two desks ends in the same place as the live check.
 */
import * as React from "react";
import { lead as leadShape } from "@shared";
import { tr } from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { useResource } from "@/lib/use-resource";
import { useAuth } from "@/app/auth/auth-context";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select as NativeSelect } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { DateTimeField } from "@/components/ui/datetime-field";
import { SearchSelect } from "@/components/ui/search-select";
import { EntityPicker } from "@/components/entity-picker";
import { quoteServices, serviceNameOf } from "@/lib/quote-request-api";
import {
  captureLead,
  clientRow,
  findDuplicates,
  tomorrowAtNine,
  type Duplicate,
} from "@/lib/lead-api";

/** "Phone or Email" is one box: an @ makes it an email, anything else a phone. */
export function splitContact(text: string): { email?: string; phone?: string } {
  const v = text.trim();
  if (!v) return {};
  return v.includes("@") ? { email: v } : { phone: v };
}

/** The live check, debounced: the rows a key matched outright. */
export function useDuplicateCheck(keys: { company_name?: string; email?: string; phone?: string }, enabled: boolean) {
  const [hits, setHits] = React.useState<Duplicate[]>([]);
  const sig = `${keys.company_name || ""}|${keys.email || ""}|${keys.phone || ""}`;
  React.useEffect(() => {
    if (!enabled) {
      setHits([]);
      return;
    }
    const company = (keys.company_name || "").trim();
    const email = (keys.email || "").trim();
    const phone = (keys.phone || "").trim();
    // A key too short to mean anything would match half the register.
    if (company.length < 2 && !email.includes("@") && phone.replace(/\D/g, "").length < 6) {
      setHits([]);
      return;
    }
    let live = true;
    const h = window.setTimeout(() => {
      findDuplicates({
        company_name: company.length >= 2 ? company : undefined,
        email: email.includes("@") ? email : undefined,
        phone: phone.replace(/\D/g, "").length >= 6 ? phone : undefined,
      })
        .then((r) => live && setHits(r.exact || []))
        .catch(() => live && setHits([]));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, enabled]);
  return hits;
}

/** "Already here: X · Client. Open It". */
export function AlreadyHere({ hit, onOpen, busy }: { hit: Duplicate; onOpen: () => void; busy?: boolean }) {
  return (
    <Callout
      tone="warn"
      title={`${tr("Already here")}: ${hit.company_name}`}
      action={
        <Button size="sm" variant="outline" onClick={onOpen} loading={busy}>
          {tr("Open It")}
        </Button>
      }
    >
      {hit.is_client ? tr("Client") : tr("Prospect")}
    </Callout>
  );
}

const CLIENT_TYPE: Record<string, string> = {
  SHIPPER: "Shipper",
  CONSIGNEE: "Consignee",
  BOTH: "Shipper and Consignee",
  CARRIER: "Carrier",
  AGENT: "Agent",
};
const SOURCE: Record<string, string> = {
  MANUAL: "Manual",
  WEBSITE: "Website",
  PORTAL: "Portal",
  EMAIL: "Email",
  REFERRAL: "Referral",
};

export function CaptureLeadDialog({
  open,
  onClose,
  onOpenLead,
}: {
  open: boolean;
  onClose: () => void;
  /** A lead was created, or an existing one was chosen: open it. */
  onOpenLead: (leadId: string) => void;
}) {
  const { user } = useAuth();
  const services = useResource(() => (open ? quoteServices() : Promise.resolve([])), [open]);
  const [company, setCompany] = React.useState("");
  const [reach, setReach] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [action, setAction] = React.useState<string>(leadShape.DEFAULT_NEXT_STEP_ACTION);
  const [dueAt, setDueAt] = React.useState(tomorrowAtNine());
  const [more, setMore] = React.useState(false);
  const [contactName, setContactName] = React.useState("");
  const [second, setSecond] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [niu, setNiu] = React.useState("");
  const [rccm, setRccm] = React.useState("");
  const [source, setSource] = React.useState("MANUAL");
  const [ownerId, setOwnerId] = React.useState<string | null>(null);
  const [ownerLabel, setOwnerLabel] = React.useState("");
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [clientType, setClientType] = React.useState("");
  const [terms, setTerms] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [refused, setRefused] = React.useState<Duplicate | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCompany("");
    setReach("");
    setServiceId("");
    setAction(leadShape.DEFAULT_NEXT_STEP_ACTION);
    setDueAt(tomorrowAtNine());
    setMore(false);
    setContactName("");
    setSecond("");
    setCountry("");
    setAddress("");
    setNiu("");
    setRccm("");
    setSource("MANUAL");
    setOwnerId(null);
    setOwnerLabel("");
    setEntityId(null);
    setClientType("");
    setTerms("");
    setError(null);
    setErrors({});
    setRefused(null);
  }, [open]);

  const first = splitContact(reach);
  const other = splitContact(second);
  const email = first.email || other.email || "";
  const phone = first.phone || other.phone || "";
  const hits = useDuplicateCheck({ company_name: company, email, phone }, open);
  const hit = refused || hits[0] || null;

  async function openExisting(d: Duplicate) {
    setOpening(true);
    try {
      const id = d.lead_id || (d.client_id ? (await clientRow(d.client_id)).lead_id : null);
      if (id) {
        onClose();
        onOpenLead(id);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setOpening(false);
    }
  }

  async function save() {
    setError(null);
    setErrors({});
    const body: Record<string, unknown> = {
      company_name: company.trim(),
      email: email || undefined,
      phone: phone || undefined,
      contact_name: contactName.trim() || undefined,
      country: country.trim() || undefined,
      address: address.trim() || undefined,
      niu: niu.trim() || undefined,
      rccm: rccm.trim() || undefined,
      source,
      owner_user_id: ownerId || user?.user_id || undefined,
      entity_id: entityId || undefined,
      client_type_hint: clientType || undefined,
      payment_terms_days: terms.trim() === "" ? undefined : Number(terms),
      service_type_id: serviceId || undefined,
      next_step: { action: action.trim(), due_at: dueAt },
    };
    const parsed = leadShape.capture.safeParse(body);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>);
      return;
    }
    setBusy(true);
    try {
      const created = await captureLead(parsed.data as Record<string, unknown>);
      onClose();
      if (created?.lead_id) onOpenLead(String(created.lead_id));
    } catch (e) {
      if (e instanceof ApiError && e.code === "LEAD_EXISTS" && e.fields) {
        const f = e.fields as unknown as Record<string, unknown>;
        setRefused({
          lead_id: (f.lead_id as string) || null,
          client_id: (f.client_id as string) || null,
          company_name: String(f.company_name || company),
          is_client: Boolean(f.is_client),
          matched_on: [],
          exact: true,
        });
      } else {
        setError(errMsg(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k]?.[0];
  const canSave = company.trim() !== "" && (email !== "" || phone !== "") && action.trim() !== "" && dueAt !== "" && !busy;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Capture Lead")}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {tr("Capture Lead")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {hit ? <AlreadyHere hit={hit} busy={opening} onOpen={() => void openExisting(hit)} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Company or Person")} required error={err("company_name")} className="sm:col-span-2">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field label={tr("Phone or Email")} required error={err("phone") || err("email")}>
            <Input value={reach} onChange={(e) => setReach(e.target.value)} placeholder="+237 6XX XXX XXX" />
          </Field>
          <Field label={tr("What Do They Need?")}>
            <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">{tr("Not known yet")}</option>
              {(services.data || []).map((s) => (
                <option key={s.service_type_id} value={s.service_type_id}>
                  {serviceNameOf(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={tr("Next Step")} required error={err("next_step")}>
            <Input value={action} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label={tr("Due")} required>
            <DateTimeField value={dueAt} onChange={setDueAt} required />
          </Field>
        </div>

        <button
          type="button"
          className="text-sm font-medium text-primary-ink hover:underline"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
        >
          {more ? tr("Fewer Details") : tr("More Details")}
        </button>

        {more ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Contact Person")}>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field label={first.email ? tr("Phone") : tr("Email")} error={first.email ? err("phone") : err("email")}>
              <Input value={second} onChange={(e) => setSecond(e.target.value)} />
            </Field>
            <Field label={tr("Country")}>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </Field>
            <Field label={tr("Address")}>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Field label="NIU">
              <Input value={niu} onChange={(e) => setNiu(e.target.value)} />
            </Field>
            <Field label="RCCM">
              <Input value={rccm} onChange={(e) => setRccm(e.target.value)} />
            </Field>
            <Field label={tr("Source")}>
              <NativeSelect value={source} onChange={(e) => setSource(e.target.value)}>
                {leadShape.SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {tr(SOURCE[s] || s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={tr("Owner")}>
              <SearchSelect
                path="/users"
                label={tr("Owner")}
                value={ownerLabel || user?.display_name || null}
                placeholder={tr("Me")}
                getKey={(u) => String(u.user_id)}
                getLabel={(u) => String(u.full_name || u.email || "")}
                onSelect={(u) => {
                  setOwnerId(String(u.user_id));
                  setOwnerLabel(String(u.full_name || u.email || ""));
                }}
              />
            </Field>
            <Field label={tr("Corporate Entity")}>
              <EntityPicker value={entityId} onChange={setEntityId} label={tr("Corporate Entity")} />
            </Field>
            <Field label={tr("Client Type")}>
              <NativeSelect value={clientType} onChange={(e) => setClientType(e.target.value)}>
                <option value="">{tr("Not known yet")}</option>
                {leadShape.CLIENT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {tr(CLIENT_TYPE[c] || c)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={tr("Payment Terms")} error={err("payment_terms_days")}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder={tr("Days")}
              />
            </Field>
          </div>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Dialog>
  );
}

export const CLIENT_TYPE_LABEL = CLIENT_TYPE;
export const SOURCE_LABEL = SOURCE;

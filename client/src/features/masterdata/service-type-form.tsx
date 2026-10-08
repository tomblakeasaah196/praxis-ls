/**
 * Service type — create/edit modal.
 *
 * Extracted from the (formerly monolithic) service-types.tsx so the list shell,
 * the 360° dossier and this form each read on their own. `key` is intentionally
 * absent from the update path: it's the stable machine identifier referenced by
 * `dictionary_item.service_type_key` and stamped onto the Control Tower map's
 * transport mode, so renaming would orphan every reference silently
 * (service_type.validator.js:9). Display names stay freely editable.
 */
import * as React from "react";
import { incoterms, serviceScope } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover } from "@/components/ui/popover";
import { Pill } from "@/components/ui/pill";
import { Modal, Field, Select } from "@/components/ui/modal";
import { errMsg } from "@/lib/use-resource";
import { cardLabel, incotermLabel } from "@/lib/quote-request-api";
import * as api from "@/lib/operations-api";

/**
 * The quote form's card and the Incoterms a service offers (meeting 6, PR 2,
 * 14300). Both default from the KEY — `SEA_FREIGHT_IMPORT` is a sea service and
 * offers all eleven ICC terms; an air, road or rail one the seven any-mode
 * terms — and both are the tenant's to correct, because a card decides which
 * questions a client is asked. Until somebody picks a card on a NEW service it
 * follows the key as it is typed, and the terms follow the card until somebody
 * ticks one; after that, their choice stands.
 */
/**
 * The eleven Incoterms, behind one button.
 *
 * They used to be eleven checkboxes in a three-column grid with a paragraph
 * over them and a reset button under them: a third of the form's height, for a
 * setting the key already gets right on almost every service anybody creates.
 * The grid is the same grid, it just waits behind its own summary now, which is
 * the state a reader actually wants ("All 11 ICC terms") rather than eleven
 * ticks they have to count.
 */
function IncotermsField({
  mode,
  terms,
  onTerms,
}: {
  mode: string;
  terms: string[];
  onTerms: (t: string[]) => void;
}) {
  const set = new Set(terms);
  const total = incoterms.CODES.length;
  const summary =
    terms.length === total
      ? tv("All {{total}} ICC terms", { total })
      : terms.length === 0
        ? tr("None chosen")
        : tv("{{count}} of {{total}} terms", { count: terms.length, total });

  return (
    <Popover
      label={tr("Incoterms offered")}
      align="start"
      className="w-[22rem] max-w-[calc(100vw-2rem)] p-3"
      trigger={
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span>{summary}</span>
          <span aria-hidden className="text-muted-foreground">
            ▾
          </span>
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {incoterms.CODES.map((code) => (
          <Checkbox
            key={code}
            checked={set.has(code)}
            onCheckedChange={(v) => {
              const next = new Set(set);
              if (v === true) next.add(code);
              else next.delete(code);
              onTerms(incoterms.normalise([...next]));
            }}
            label={incotermLabel(code)}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 w-full"
        onClick={() => onTerms(incoterms.defaultsForMode(mode))}
      >
        {tr("Reset to ICC 2020 defaults")}
      </Button>
    </Popover>
  );
}

function QuoteFields({
  mode,
  terms,
  onMode,
  onTerms,
}: {
  mode: string;
  terms: string[];
  onMode: (m: string) => void;
  onTerms: (t: string[]) => void;
}) {
  return (
    <>
      <Field
        label={tr("Quote Form Card")}
        about={tr("Where this service sits when a client asks for a price: the website, the client portal and the desk.")}
        aboutLabel={tr("About the quote form card")}
      >
        <Select value={mode} onChange={(e) => onMode(e.target.value)}>
          {serviceScope.MODES.map((m) => (
            <option key={m} value={m}>
              {cardLabel(m)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={tr("Incoterms Offered")}
        about={tr("A request may use only these, or “To be determined”. FAS, FOB, CFR and CIF are sea and inland waterway only.")}
        aboutLabel={tr("About incoterms offered")}
      >
        <IncotermsField mode={mode} terms={terms} onTerms={onTerms} />
      </Field>
    </>
  );
}

export function ServiceTypeForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.ServiceType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const [f, setF] = React.useState({
    key: row?.key ?? "",
    name_fr: row?.name_fr ?? "",
    name_en: row?.name_en ?? "",
    territory: row?.territory ?? "",
    // ROUTE, not "", because the column is NOT NULL with that default — an
    // empty option here would offer a state the database does not have.
    enquiry_shape: (row?.enquiry_shape ?? "ROUTE") as api.EnquiryShape,
    ops_reference_code: row?.ops_reference_code ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // The card and the terms — see QuoteFields. `touched` stops the defaults
  // following the key once somebody has chosen.
  const initialMode = row?.transport_mode || serviceScope.modeFromKey(row?.key);
  const [mode, setMode] = React.useState<string>(initialMode);
  const [terms, setTerms] = React.useState<string[]>(row?.incoterms ?? incoterms.defaultsForMode(initialMode));
  const [modeTouched, setModeTouched] = React.useState(!isNew);
  const [termsTouched, setTermsTouched] = React.useState(!isNew);
  React.useEffect(() => {
    if (modeTouched) return;
    const m = serviceScope.modeFromKey(f.key);
    setMode(m);
    if (!termsTouched) setTerms(incoterms.defaultsForMode(m));
  }, [f.key, modeTouched, termsTouched]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Blank means "derive one from the key" — sending "" would fail the
      // two-character rule for a field the user never touched.
      const opsCode = f.ops_reference_code.trim().toUpperCase() || undefined;
      if (isNew) {
        await api.createServiceType({
          key: f.key.trim().toUpperCase(),
          name_fr: f.name_fr,
          name_en: f.name_en || undefined,
          territory: f.territory || undefined,
          enquiry_shape: f.enquiry_shape,
          transport_mode: mode,
          incoterms: terms,
          ops_reference_code: opsCode,
        });
      } else {
        // `key` is intentionally absent: it's the stable identifier referenced by
        // dictionary_item.service_type_key, so renaming would orphan references.
        await api.updateServiceType(row!.service_type_id, {
          name_fr: f.name_fr,
          name_en: f.name_en || null,
          territory: f.territory || null,
          enquiry_shape: f.enquiry_shape,
          transport_mode: mode,
          incoterms: terms,
          // Unchanged codes are not resent: the API refuses a change once a file
          // has used one, and echoing the same value would turn a name edit into
          // a rejected save on a service type that has been in use for months.
          ...(opsCode && opsCode !== (row!.ops_reference_code || "") ? { ops_reference_code: opsCode } : {}),
        });
      }
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
      title={isNew ? tr("New Service Type") : tr("Edit Service Type")}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/*
            PERMANENCE IS SHOWN, NOT EXPLAINED (guide §3.17).

            This field carried a sentence saying the key could never be changed.
            On an existing service that sentence was redundant, because the
            input is already disabled, and a disabled input says "not yours to
            change" faster than any wording. On a NEW service it was the one
            thing the operator had to know, and it was set in small grey
            uppercase under the box, which is where the eye goes last.

            So the warning became a badge ON the label, where it is read before
            the field rather than after it, and the detail it used to spell out
            moved behind the ⓘ for the one person in ten who wants to know why.
          */}
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                {tr("Key")}
                {isNew ? <Pill tone="warn">{tr("Permanent")}</Pill> : null}
              </span>
            }
            required
            className={isNew ? "" : "opacity-60"}
            about={
              isNew
                ? tr("The machine name, in SCREAMING_SNAKE. Other records point at it, so it cannot be changed once saved.")
                : tr("Fixed. Dictionary items and operations files point at this key.")
            }
            aboutLabel={tr("About the key")}
          >
            <Input
              value={f.key}
              onChange={(e) => set("key", e.target.value.toUpperCase())}
              placeholder="SEA_FREIGHT_IMPORT"
              disabled={!isNew}
            />
          </Field>
          <Field label={tr("Territory")}>
            <Select
              value={f.territory}
              onChange={(e) => set("territory", e.target.value)}
            >
              <option value="">{tr("None")}</option>
              {api.TERRITORIES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          {/* Sales-side, and deliberately next to Territory so the difference is
              visible: Territory is where the goods move, which routes a dossier.
              This is what a stranger is asked on the public quote form, and it
              is authored rather than guessed — the form used to infer it from
              the service key, so anything that was not warehousing demanded an
              origin, a destination and an Incoterm, including services that
              move nothing at all. */}
          <Field
            label={tr("Quote Form Asks For")}
            about={tr("What a visitor has to tell you before the request form will continue.")}
            aboutLabel={tr("About what the quote form asks for")}
          >
            <Select
              value={f.enquiry_shape}
              onChange={(e) =>
                set("enquiry_shape", e.target.value as api.EnquiryShape)
              }
            >
              {api.ENQUIRY_SHAPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {tr(o.label)}
                </option>
              ))}
            </Select>
          </Field>
          <QuoteFields
            mode={mode}
            terms={terms}
            onMode={(m) => {
              setModeTouched(true);
              setMode(m);
              if (!termsTouched) setTerms(incoterms.defaultsForMode(m));
            }}
            onTerms={(t) => {
              setTermsTouched(true);
              setTerms(t);
            }}
          />
          <Field label="Name (FR)" required>
            <Input
              value={f.name_fr}
              onChange={(e) => set("name_fr", e.target.value)}
              placeholder="Fret maritime import"
            />
          </Field>
          <Field label={tr("Name (EN)")}>
            <Input
              value={f.name_en}
              onChange={(e) => set("name_en", e.target.value)}
              placeholder="Sea freight import"
            />
          </Field>
          {/*
            The two characters that CLOSE an operations file's reference —
            `SM` in `SL7Z3K9QW2M4XBSM`. Shown here rather than hidden because the
            business already reads these off legacy paperwork ("that's an SM
            file"), and because it is frozen the moment a file uses it: better to
            let someone set the code they actually use before that happens than
            to discover it afterwards.
          */}
          {/*
            The live example moved into the ⓘ rather than being deleted: it is
            the clearest thing on the field, because two letters in isolation
            mean nothing and SL7Z3K9QW2M4XBSM means everything to somebody who
            reads these off paperwork. It interpolates the typed value, so the
            panel shows the reference this service is about to mint.
          */}
          <Field
            label={tr("Reference Code")}
            about={tv(
              "Closes this service's file references, like {{example}}. Blank generates one. Fixed once a file has used it.",
              { example: `SL7Z3K9QW2M4XB${f.ops_reference_code || "SM"}` },
            )}
            aboutLabel={tr("About the reference code")}
          >
            <Input
              value={f.ops_reference_code}
              onChange={(e) => set("ops_reference_code", e.target.value.toUpperCase().slice(0, 2))}
              placeholder={isNew ? "auto" : "SM"}
              maxLength={2}
            />
          </Field>
        </div>
        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={busy || !f.name_fr || (isNew && !f.key)}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

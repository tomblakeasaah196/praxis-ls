/**
 * The contract editor (0700, 12766) — where a contract stops being a filing
 * reference and becomes an instrument.
 *
 * ── WHAT CHANGED, AND WHY THE SHAPE IS DIFFERENT ──────────────────────────
 *
 * It used to be two columns: the agreed terms on the left, and on the right a
 * body a model had written from scratch, editable as free text. That was a
 * reasonable way to get prose and a poor way to get a contract — two hires on
 * identical terms produced different documents, and nothing in the pipeline
 * noticed that the model was writing in English against Cameroonian labour law.
 *
 * The text now comes from one of eighteen authored clause libraries, chosen by
 * the contract's kind and the employment type, in one language. So the left
 * column is no longer "facts for the model" — it is the facts the LIBRARY needs
 * to fill itself, and the screen's whole job is to show which of them are still
 * missing before anything is generated.
 *
 * ── THE READINESS PANEL IS THE POINT ──────────────────────────────────────
 *
 * The composer refuses rather than printing a contract with a hole in it, and
 * it names every missing fact at once. That refusal is only useful if somebody
 * can act on it, so the panel maps each token back to the field it comes from
 * and says WHERE that field lives — most of them are on the employee record,
 * not on this screen, and "go and fill in the mother's name" is a far more
 * useful thing to be told than "generation failed".
 *
 * ── AND THE SIGNING SURFACE IS MOUNTED HERE ───────────────────────────────
 *
 * A contract is the document this product most needs signed, and until now the
 * signature engine — four cards, external signing by emailed link and OTP —
 * was wired to delivery notes and transit orders and not to this. Both panels
 * render nothing when there is nothing to show, so a tenant with signatures
 * switched off never sees an empty section.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Markdown } from "@/components/markdown";
import {
  SendForSignatureModal,
  SignatureChainOnRecord,
  SignaturesOnRecord,
} from "@/features/vault/sign-document";
import { errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";
import { EMPLOYMENT_TYPES, PAYMENT_METHODS } from "./employee-form-model";

const numOrUndef = (v: string) => (v === "" ? undefined : Number(v));

/**
 * A missing token, in words, and where to go and fix it.
 *
 * The server refuses on TOKEN names — `employee.father_name`, `term.end_date` —
 * because that is what the clause text actually references, and translating
 * them into field labels server-side would put the wording of a form in the
 * API. So the mapping lives here, next to the screen that renders it.
 *
 * `where` matters more than the label. Most of these are on the EMPLOYEE
 * record, a few are on the corporate entity, and only a handful are typed on
 * this screen — telling somebody "the mother's name is missing" without saying
 * where to type it is barely better than not telling them.
 */
const MISSING: Record<string, { label: string; where: string }> = {
  "employee.civility": { label: "Civility", where: "employee" },
  "employee.full_name": { label: "Full name", where: "employee" },
  "employee.birth_date": { label: "Date of birth", where: "employee" },
  "employee.birth_place": { label: "Place of birth", where: "employee" },
  "employee.father_name": { label: "Father's name", where: "employee" },
  "employee.mother_name": { label: "Mother's name", where: "employee" },
  "employee.nationality": { label: "Nationality", where: "employee" },
  "employee.id_type": { label: "ID document type", where: "employee" },
  "employee.id_number": { label: "ID document number", where: "employee" },
  "employee.id_issued_on": { label: "ID issued on", where: "employee" },
  "employee.id_issued_at": { label: "ID issued at", where: "employee" },
  "employee.residence": { label: "Residence address", where: "employee" },
  "employee.staff_no": { label: "Matricule", where: "employee" },
  "entity.legal_name": { label: "Legal name", where: "entity" },
  "entity.legal_form": { label: "Legal form (SARL, SA…)", where: "entity" },
  "entity.address": { label: "Registered address", where: "entity" },
  "entity.po_box": { label: "PO box", where: "entity" },
  "entity.country": { label: "Country", where: "entity" },
  "entity.phone": { label: "Telephone", where: "entity" },
  "entity.email": { label: "Email", where: "entity" },
  "rep.name": { label: "Employer's signatory", where: "entity" },
  "rep.title": { label: "Signatory's capacity", where: "entity" },
  "term.job_title": { label: "Job title", where: "here" },
  "term.start_date": { label: "Start date", where: "here" },
  "term.end_date": { label: "End date", where: "here" },
  "term.offer_valid_until": { label: "Offer valid until", where: "here" },
  "term.probation_end_date": { label: "Probation ends on", where: "here" },
  "term.duration_months": { label: "Duration (months)", where: "here" },
  "term.probation_months": { label: "Probation (months)", where: "here" },
  "term.notice_days": { label: "Notice (days)", where: "here" },
  "term.place_of_work": { label: "Place of work", where: "here" },
  "term.working_hours": { label: "Working hours", where: "here" },
  "term.weekly_hours": { label: "Weekly hours", where: "here" },
  "pay.base": { label: "Base salary", where: "here" },
  "pay.gross": { label: "Monthly gross", where: "here" },
  "pay.currency": { label: "Currency", where: "here" },
  "pay.method": { label: "Payment method", where: "here" },
  "doc.place_signed": { label: "Place of signature", where: "here" },
  "doc.jurisdiction_city": { label: "Court city", where: "here" },
};

const WHERE_WORDS: Record<string, string> = {
  employee: "On the employee record",
  entity: "On the corporate entity",
  here: "On this screen",
};

/** What is missing, grouped by where somebody has to go to fix it. */
function MissingFacts({ missing }: { missing: string[] }) {
  const groups = React.useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const token of missing) {
      const m = MISSING[token];
      const where = m ? m.where : "here";
      (out[where] ||= []).push(m ? m.label : token);
    }
    return out;
  }, [missing]);

  return (
    <Callout
      tone="warn"
      title={`${missing.length} ${missing.length === 1 ? "fact is" : "facts are"} missing`}
    >
      <p className="mb-2">
        {tr(
          "The contract text states each of these, so it cannot be generated until they are recorded. A contract with a blank where a legal identification belongs is worse than no contract.",
        )}
      </p>
      <div className="space-y-1.5">
        {Object.entries(groups).map(([where, labels]) => (
          <div key={where}>
            <span className="micro">{tr(WHERE_WORDS[where] || where)}</span>
            <span className="text-sm"> — {labels.join(", ")}</span>
          </div>
        ))}
      </div>
    </Callout>
  );
}

export function ContractEditor({
  contract,
  onClose,
  onSaved,
}: {
  contract: api.Contract;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    language: (contract.language || "") as string,
    employment_type: contract.employment_type || "",
    employer_person_id: contract.employer_person_id || "",
    job_title: contract.job_title || "",
    effective_on: contract.effective_on || "",
    end_on: contract.end_on || "",
    probation_ends_on: contract.probation_ends_on || "",
    base_salary: contract.base_salary == null ? "" : String(contract.base_salary),
    salary_currency: contract.salary_currency || "XAF",
    probation_months: contract.probation_months == null ? "" : String(contract.probation_months),
    notice_days: contract.notice_days == null ? "" : String(contract.notice_days),
    weekly_hours: "",
    working_hours: contract.working_hours || "",
    place_of_work: contract.place_of_work || "",
    payment_method: "",
    place_signed: contract.place_signed || "",
    jurisdiction_city: contract.jurisdiction_city || "",
  });
  const [body, setBody] = React.useState(contract.body_md || "");
  const [meta, setMeta] = React.useState({
    ai_generated: !!contract.ai_generated,
    ai_model: contract.ai_model || null as string | null,
    probation_ends_on: contract.probation_ends_on || null as string | null,
    library: contract.clause_library_key || null as string | null,
    version: contract.clause_library_version || null as string | null,
  });
  const [report, setReport] = React.useState<api.ComposeReport | null>(null);
  const [ready, setReady] = React.useState<api.ContractReadiness | null>(null);
  const [readyStale, setReadyStale] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [signRefresh, setSignRefresh] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const locked = contract.status !== "DRAFT";
  const entityRef = `hr_contract:${contract.hr_contract_id}`;

  const terms = React.useCallback((): api.ContractTerms => ({
    language: (f.language || undefined) as "fr" | "en" | undefined,
    employment_type: f.employment_type || undefined,
    employer_person_id: f.employer_person_id || undefined,
    job_title: f.job_title || undefined,
    effective_on: f.effective_on || undefined,
    end_on: f.end_on || undefined,
    probation_ends_on: f.probation_ends_on || undefined,
    base_salary: numOrUndef(f.base_salary),
    salary_currency: f.salary_currency || undefined,
    probation_months: numOrUndef(f.probation_months),
    notice_days: numOrUndef(f.notice_days),
    weekly_hours: numOrUndef(f.weekly_hours),
    working_hours: f.working_hours || undefined,
    place_of_work: f.place_of_work || undefined,
    payment_method: f.payment_method || undefined,
    place_signed: f.place_signed || undefined,
    jurisdiction_city: f.jurisdiction_city || undefined,
  }), [f]);

  /*
   * What is still missing, re-asked as the terms change.
   *
   * Debounced, because this fires on every keystroke in a text field and the
   * answer is only interesting once somebody stops typing. The endpoint never
   * throws on a MISSING FACT — that is the whole reason it is separate from
   * composing — so a failure here is the network or the session, not the form.
   *
   * A failure keeps the last answer and says it may be out of date, rather
   * than clearing the panel or raising an error over the whole screen. Both of
   * those are worse: an empty readiness panel reads as "nothing is missing",
   * which is the one thing it must never say when it does not know.
   */
  React.useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.contractReadiness(contract.hr_contract_id, terms())
        .then((r) => { if (!cancelled) { setReady(r); setReadyStale(false); } })
        .catch(() => { if (!cancelled) setReadyStale(true); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [contract.hr_contract_id, terms]);

  async function compose(refine: boolean) {
    setBusy(refine ? "compose" : "compose-plain");
    setError(null);
    try {
      const row = await api.composeContract(contract.hr_contract_id, { ...terms(), refine });
      setBody(row.body_md || "");
      setReport(row.composition || null);
      setMeta({
        ai_generated: !!row.ai_generated,
        ai_model: row.ai_model || null,
        probation_ends_on: row.probation_ends_on || null,
        library: row.clause_library_key || null,
        version: row.clause_library_version || null,
      });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const t = terms();
      await api.updateContract(contract.hr_contract_id, {
        job_title: t.job_title,
        effective_on: t.effective_on,
        end_on: t.end_on,
        salary_currency: t.salary_currency,
        probation_months: t.probation_months,
        notice_days: t.notice_days,
        working_hours: t.working_hours,
        place_of_work: t.place_of_work,
        // The wording only travels while the contract is a DRAFT. Past that the
        // server refuses it, and sending it back unchanged would make every
        // "record the terms" save depend on the text round-tripping byte for
        // byte.
        ...(locked ? {} : { body_md: body }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const signatories = ready?.signatories || [];
  const missing = ready?.missing || [];

  return (
    <Modal
      open
      onClose={onClose}
      title={contract.title || "Contract"}
      description={`${contract.employee_name || "—"} · ${(contract.kind || "").replace(/_/g, " ").toLowerCase()}`}
    >
      <div className="flex flex-col gap-4">
        {locked && (
          /* The TEXT is frozen; the TERMS are not.
           *
           * Rewriting the wording of a signed contract is rewriting history —
           * a renewal supersedes it. But every contract signed before this
           * feature existed has no notice period and no probation date on the
           * row, and typing in what the signed paper already says is not
           * amending anything. Without it the expiry watcher can never see an
           * existing fixed term, for the whole back catalogue, for ever. */
          <Callout tone="info" title={`This contract is ${contract.status.toLowerCase()}`}>
            {tr(
              "Its wording is fixed — supersede it with a renewal to change that. You can still record the terms it states, so probation and expiry are watched and payroll knows the notice period.",
            )}
          </Callout>
        )}

        {!locked && ready && !ready.ready && missing.length > 0 && (
          <MissingFacts missing={missing} />
        )}
        {readyStale && (
          <p className="text-xs text-muted-foreground">
            {tr(
              "Could not re-check what is missing just now, so the list above may be out of date. Composing will still refuse, and say exactly what it needs.",
            )}
          </p>
        )}

        {ready?.error === "NO_CLAUSE_LIBRARY" && (
          <Callout tone="warn" title={tr("No clause library for this contract")}>
            {tr(
              "Nobody has written the wording for this combination of contract type and language, so there is nothing to compose from. Pick another type, or draft the text by hand.",
            )}
          </Callout>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* THE TERMS — the facts the clause library fills itself from. */}
          <div className="flex flex-col gap-3">
            <p className="micro">{tr("Agreed terms")}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={tr("Language")}
                hint={tr("One language. Never both.")}
              >
                <Select value={f.language} disabled={locked} onChange={(e) => set("language", e.target.value)}>
                  <option value="">{tr("Entity default")}</option>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
              </Field>
              <Field label={tr("Contract type")} hint={tr("Chooses the clause library.")}>
                <Select
                  value={f.employment_type}
                  disabled={locked || contract.kind !== "EMPLOYMENT"}
                  onChange={(e) => set("employment_type", e.target.value)}
                >
                  <option value="">{tr("From the employee")}</option>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Who binds the employer. The list is the entity's own register of
                directors, officers and signatories — the same filter the server
                resolves with, so what is offered here is what would be used. */}
            <Field
              label={tr("Signed for the employer by")}
              hint={signatories.length ? undefined : tr("Add a director or signatory on the entity first.")}
            >
              <Select
                value={f.employer_person_id}
                disabled={locked || signatories.length === 0}
                onChange={(e) => set("employer_person_id", e.target.value)}
              >
                <option value="">
                  {ready?.representative
                    ? `${ready.representative.full_name}${ready.representative.title ? ` — ${ready.representative.title}` : ""}`
                    : tr("—")}
                </option>
                {signatories.map((p) => (
                  <option key={p.person_id} value={p.person_id}>
                    {p.full_name}{p.title ? ` — ${p.title}` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={tr("Job title")}>
              <Input value={f.job_title} onChange={(e) => set("job_title", e.target.value)} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tr("Starts")}>
                <Input type="date" value={f.effective_on} onChange={(e) => set("effective_on", e.target.value)} />
              </Field>
              <Field label={tr("Ends")} hint={tr("Leave blank for an indefinite term.")}>
                <Input type="date" value={f.end_on} onChange={(e) => set("end_on", e.target.value)} />
              </Field>
              <Field label={tr("Base salary")} hint={tr("Allowances are added from the employee record.")}>
                <Input
                  type="number"
                  min="0"
                  className="num text-right"
                  value={f.base_salary}
                  onChange={(e) => set("base_salary", e.target.value)}
                />
              </Field>
              <Field label={tr("Currency")}>
                <Select value={f.salary_currency} onChange={(e) => set("salary_currency", e.target.value)}>
                  <option value="XAF">XAF</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
              {/* Art. 28: six months including any renewal. */}
              <Field label={tr("Probation (months)")} hint={tr("Six at most, renewal included.")}>
                <Input
                  type="number"
                  min="0"
                  max="6"
                  className="num text-right"
                  value={f.probation_months}
                  onChange={(e) => set("probation_months", e.target.value)}
                />
              </Field>
              <Field label={tr("Notice (days)")}>
                <Input
                  type="number"
                  min="0"
                  max="365"
                  className="num text-right"
                  value={f.notice_days}
                  onChange={(e) => set("notice_days", e.target.value)}
                />
              </Field>
            </div>

            <Field label={tr("Working hours")}>
              <Input
                value={f.working_hours}
                onChange={(e) => set("working_hours", e.target.value)}
                placeholder="08:00–17:00, Monday to Friday"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tr("Place of work")}>
                <Input value={f.place_of_work} onChange={(e) => set("place_of_work", e.target.value)} />
              </Field>
              <Field label={tr("Paid by")}>
                <Select value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
                  <option value="">{tr("From the employee")}</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{tr(m.label)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Signed at")} hint={tr("Defaults to the place of work.")}>
                <Input value={f.place_signed} onChange={(e) => set("place_signed", e.target.value)} />
              </Field>
              <Field label={tr("Court city")} hint={tr("Where a dispute would be heard.")}>
                <Input value={f.jurisdiction_city} onChange={(e) => set("jurisdiction_city", e.target.value)} />
              </Field>
            </div>

            {meta.probation_ends_on && (
              <p className="text-xs text-muted-foreground">
                {tr("Probation ends")}{" "}
                <span className="num text-foreground">{dateFmt(meta.probation_ends_on)}</span>
                {" "}— {tr("you will be warned before it does.")}
              </p>
            )}
            {f.base_salary && (
              <p className="text-xs text-muted-foreground">
                {tr("Base")} {money(Number(f.base_salary))} —{" "}
                {tr("the contract states this beside each standing allowance, and totals them.")}
              </p>
            )}
          </div>

          {/* THE TEXT — composed from the library, and what gets printed. */}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="micro">{tr("Contract text")}</p>
                {meta.library ? (
                  /* WHICH WORDING THIS IS. A contract composed in March and one
                     composed in September are different documents if the
                     library was revised between them, and the version is the
                     only thing that can say so. */
                  <Pill tone="mute">{meta.library} · {meta.version}</Pill>
                ) : null}
                {meta.ai_generated ? (
                  /* A model touched ONE clause. It never wrote a term — it is
                     handed the authored clause with its placeholders intact and
                     a rewrite that moved one is thrown away. The pill says
                     "finished", not "drafted", because "drafted by AI" on a
                     composed contract would be a lie about who wrote it. */
                  <Pill tone="blue">{tr("Duties clause finished by")} {meta.ai_model}</Pill>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={cn("chip", preview && "on")} onClick={() => setPreview((v) => !v)}>
                  {preview ? tr("Edit") : tr("Preview")}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === "compose-plain"}
                  disabled={locked || !!busy}
                  onClick={() => compose(false)}
                >
                  {tr("Compose")}
                </Button>
                <Button
                  size="sm"
                  loading={busy === "compose"}
                  disabled={locked || !!busy}
                  onClick={() => compose(true)}
                >
                  {tr("Compose & finish with AI")}
                </Button>
              </div>
            </div>

            {report && (report.omitted.length > 0 || report.ai_rejected.length > 0) && (
              <div className="space-y-2">
                {report.omitted.length > 0 && (
                  /* An article left out ON PURPOSE, and the fact that left it
                     out. Shown because "this contract has no probation clause"
                     must be visibly a decision rather than a fault — art. 28
                     makes probation a stipulation, so an engagement with none
                     agreed correctly has no such article. */
                  <Callout tone="info" title={tr("Clauses left out")}>
                    {report.omitted.map((o) => (
                      <div key={o.key} className="text-sm">
                        {o.heading} — {tr("nothing was recorded for")}{" "}
                        {o.because.map((t) => (MISSING[t]?.label || t)).join(", ")}
                      </div>
                    ))}
                  </Callout>
                )}
                {report.ai_rejected.length > 0 && (
                  <Callout tone="warn" title={tr("An AI rewrite was discarded")}>
                    {report.ai_rejected.map((r) => (
                      <div key={r.article} className="text-sm">
                        {r.article} — {r.reason}. {tr("The authored clause was kept.")}
                      </div>
                    ))}
                  </Callout>
                )}
              </div>
            )}

            {preview ? (
              <div className="lux-card max-h-[52vh] overflow-y-auto p-4">
                {body ? (
                  <Markdown text={body} />
                ) : (
                  <p className="text-sm text-muted-foreground">{tr("Nothing composed yet.")}</p>
                )}
              </div>
            ) : (
              <>
                <label className="sr-only" htmlFor="contract-body">
                  {tr("Contract text")}
                </label>
                <textarea
                  id="contract-body"
                  className="h-[52vh] w-full resize-none rounded-lg border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                  value={body}
                  disabled={locked}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={tr(
                    "Press Compose to fill the clause library from this record. You can edit the result here — use ## for each article heading, which is what the printed contract splits on.",
                  )}
                />
              </>
            )}
            {!body && !locked && (
              <p className="text-xs text-[rgb(var(--warn))]">
                {tr(
                  "Until this has text, the generated PDF prints a letterhead and two names with no clauses between them.",
                )}
              </p>
            )}
            {!body && locked && (
              /* An old contract signed on paper. Generating a PDF would print
                 an empty form, and reconstructing signed wording with a model
                 is the one place a plausible-looking output is genuinely
                 dangerous — so the honest route is the scan. */
              <p className="text-xs text-muted-foreground">
                {tr(
                  "No text was ever recorded for this contract, so generating a PDF would print an empty form. Upload the signed copy instead — that is the document both parties actually agreed.",
                )}
              </p>
            )}
          </div>
        </div>

        {/*
          * Who was ASKED, and who HAS signed. Two panels because they answer
          * different questions — a request still out with the employer's
          * signature already on it is the normal mid-chain state, and either
          * view alone reads as a fault. Both render nothing when there is
          * nothing to show.
          */}
        <SignatureChainOnRecord entityRef={entityRef} title={tr("Out for signature")} refreshKey={signRefresh} />
        <SignaturesOnRecord entityRef={entityRef} title={tr("Signatures on this contract")} />

        {error && <ErrorState message={error} />}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={!!busy}>
            {tr("Close")}
          </Button>
          {/* Sending for signature needs a document to sign. Offered from
              ISSUED onward — a draft is not an instrument anybody should be
              asked to put their name to. */}
          {body && contract.status === "ISSUED" && (
            <Button type="button" variant="outline" onClick={() => setSending(true)}>
              {tr("Send for signature")}
            </Button>
          )}
          {/* Enabled on a signed contract too — it saves the TERMS, which is a
              different act from rewriting the wording. `save` omits body_md
              once the contract is locked, so there is nothing for the server to
              refuse. */}
          <Button loading={busy === "save"} disabled={!!busy} onClick={save}>
            {locked ? tr("Record terms") : tr("Save")}
          </Button>
        </div>
      </div>

      <SendForSignatureModal
        open={sending}
        entityRef={entityRef}
        docType="EMPLOYMENT_CONTRACT"
        onClose={() => setSending(false)}
        onSent={() => {
          setSending(false);
          setSignRefresh((n) => n + 1);
        }}
      />
    </Modal>
  );
}

export default ContractEditor;

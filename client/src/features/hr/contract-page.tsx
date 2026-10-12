/**
 * Contract 360 — `/hr/contracts/:contractId`.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * A `<Modal>` with no `size` prop, which is `max-w-lg`: 512 pixels. Inside it,
 * a `lg:grid-cols-[320px_1fr]` document layout. `lg:` is a VIEWPORT breakpoint,
 * so on a 1920px screen the two-column grid engaged inside a 512px box — the
 * terms took their fixed 320 and the contract text got what was left, about
 * 150 pixels. The result was a four-page legal document being edited in a pane
 * that wrapped its own placeholder two words to a line, with the "Draft with
 * AI" button clipped by the dialog edge and a horizontal scrollbar along the
 * bottom.
 *
 * The cramping was the symptom. The cause is that a contract is not a form. It
 * is the record an employment relationship is defended with, and it needs an
 * address: a URL you can send someone, a page that survives a refresh
 * mid-draft, a ⌘K entry, and a route the shell can permission-filter — an
 * unregistered route is treated as ungated, which on a screen showing salaries
 * is the wrong default.
 *
 * ── THE THREE REGIONS, AND WHY THE WIDTHS ARE WHAT THEY ARE ───────────────
 *
 * Terms on the left at a fixed 320, because they are short labelled fields and
 * a wider column just spreads them out. The document in the middle taking
 * everything left over, because it is the thing being worked on. The record's
 * context on the right — what is wrong with it, who signed it, what it
 * replaces, what else this person has signed — at a fixed 320, because it is
 * read rather than typed into.
 *
 * The grid only splits where there is room for the columns it is making, and
 * the third region appears a breakpoint later than the second. That is the
 * whole lesson of the dialog this replaces.
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/hr-api";
import { tenant } from "@/lib/api-client";
import { useResource, errMsg } from "@/lib/use-resource";
import { useDebounced } from "@/lib/use-debounced";
import { pageShell } from "@/lib/layout";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { ContractTextEditor } from "./contract-text-editor";
import { useContractEditor } from "./use-contract-editor";

const numOrUndef = (v: string) => (v === "" ? undefined : Number(v));

const STATUS_TONE: Record<string, "ok" | "warn" | "mute" | "blue"> = {
  DRAFT: "mute",
  ISSUED: "blue",
  SIGNED: "ok",
  ENDED: "warn",
};

const KIND_LABEL: Record<string, string> = {
  EMPLOYMENT: "Employment Contract",
  OFFER_LETTER: "Offer of Employment",
  CONFIRMATION: "Certificate of Employment",
  TERMINATION: "Notice of Termination",
};

/* ── the paper ─────────────────────────────────────────────────────────────*/

type Preview = { html: string };

/**
 * The contract as it will print, on the tenant's own letterhead.
 *
 * Sandboxed and same-origin-only, the same frame `components/document-view`
 * uses — the HTML is our own renderer's output, but it carries a full
 * stylesheet and must not inherit or reach into the app's.
 *
 * It re-fetches when the SAVED body changes, not on every keystroke: this is a
 * server render of the stored record, so previewing an unsaved draft would
 * show the previous text under the new terms and quietly mislead.
 */
function ContractPaper({ id, revision }: { id: string; revision: number }) {
  const preview = useResource<Preview>(
    () =>
      tenant<Preview>(`/document-templates/EMPLOYMENT_CONTRACT/preview`, {
        method: "POST",
        body: { record_id: id },
      }),
    [id, revision],
  );

  if (preview.loading) return <Skeleton className="h-[60vh] w-full rounded-lg" />;
  if (preview.error) return <ErrorState message={preview.error} />;
  if (!preview.data?.html) return <EmptyState title="Nothing to preview" />;

  return (
    /* THE FRAME SCROLLS, rather than being measured and grown.
     *
     * `components/document-view` reads the loaded document's scrollHeight to
     * make its preview seamless inside a page that scrolls as a whole. That
     * read is a cross-origin access the browser may refuse, so it needs a
     * try/catch with nothing in it — and the client's silent-catch taxonomy
     * (storage, parse, teardown) has no honest class for "the browser said
     * no", which is how that one became a standing lint warning.
     *
     * Here the pane around it already scrolls and the contract is several
     * pages, so there is nothing to gain: a full-height frame with its own
     * scrollbar is the same reading experience, with no measurement, no state
     * and no catch. */
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[rgb(var(--ink)_/_0.06)] p-4">
      <iframe
        title={tr("Contract preview")}
        srcDoc={preview.data.html}
        sandbox="allow-same-origin"
        className="h-full min-h-[60vh] w-full rounded-md bg-white"
      />
    </div>
  );
}

/* ── the right rail ────────────────────────────────────────────────────────*/

function SignaturePanel({ signatures }: { signatures: api.ContractSignature[] }) {
  if (!signatures.length) {
    return <p className="micro">Not signed.</p>;
  }
  return (
    <ul className="space-y-2">
      {signatures.map((s) => (
        <li key={s.signature_id} className="flex items-start justify-between gap-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{s.signer_name || "—"}</div>
            <div className="micro">
              {[s.signer_role, s.party].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {/* A revoked signature still shows. "Nobody signed this" and
                "somebody signed it and it was withdrawn" are different facts,
                and only one of them is a reason to re-issue. */}
            {s.revoked_at ? (
              <Pill tone="warn">{tr("Revoked")}</Pill>
            ) : (
              <span className="num text-xs text-muted-foreground">{dateFmt(s.signed_at)}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const RELATION_LABEL: Record<string, string> = {
  renews: "Replaces",
  superseded_by: "Replaced By",
  sibling: "Also on File",
};

function ChainPanel({
  chain,
  currency,
}: {
  chain: api.ContractChainRow[];
  currency: string;
}) {
  const navigate = useNavigate();
  if (!chain.length) return <p className="micro">No other contracts for this person.</p>;

  // Grouped so the renewal chain reads before the rest of the history: what
  // this contract replaces and what replaced it are the two rows somebody
  // opening an old contract most needs to see.
  const order: api.ContractChainRow["relation"][] = ["superseded_by", "renews", "sibling"];
  return (
    <div className="space-y-3">
      {order.map((relation) => {
        const rows = chain.filter((c) => c.relation === relation);
        if (!rows.length) return null;
        return (
          <div key={relation} className="space-y-1">
            <p className="micro">{RELATION_LABEL[relation]}</p>
            {rows.map((c) => (
              <button
                key={c.hr_contract_id}
                type="button"
                onClick={() => navigate(`/hr/contracts/${c.hr_contract_id}`)}
                className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0 truncate">
                  {c.doc_number || KIND_LABEL[c.kind || ""] || c.kind}
                  {c.effective_on ? (
                    <span className="micro ml-1">{dateFmt(c.effective_on)}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {c.gross_salary != null && (
                    <span className="num text-xs text-muted-foreground">
                      {money(Number(c.gross_salary), c.salary_currency || currency)}
                    </span>
                  )}
                  <Pill tone={STATUS_TONE[c.status] || "mute"}>{c.status}</Pill>
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────────*/

export function ContractPage() {
  const { contractId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const contract = useResource(() => api.getContract(contractId), [contractId]);
  const dossier = useResource(() => api.contractDossier(contractId), [contractId]);

  const c = contract.data;
  const locked = !!c && c.status !== "DRAFT";

  const [f, setF] = React.useState<Record<string, string>>({});
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"text" | "paper">("text");
  const [review, setReview] = React.useState<api.ContractWarning[]>([]);
  const [reviewFailed, setReviewFailed] = React.useState(false);
  /** Bumped on every successful save, so the paper re-renders the stored
   *  record rather than a stale one. */
  const [revision, setRevision] = React.useState(0);

  // Seeded once per contract, then owned by the form. Re-seeding on every
  // fetch would discard what somebody is in the middle of typing.
  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!c || seeded.current === c.hr_contract_id) return;
    seeded.current = c.hr_contract_id;
    setF({
      title: c.title || "",
      language: c.language || "en",
      professional_category: c.professional_category || "",
      job_title: c.job_title || "",
      effective_on: c.effective_on || "",
      end_on: c.end_on || "",
      gross_salary: c.gross_salary == null ? "" : String(c.gross_salary),
      salary_currency: c.salary_currency || "XAF",
      probation_months: c.probation_months == null ? "" : String(c.probation_months),
      notice_days: c.notice_days == null ? "" : String(c.notice_days),
      working_hours: c.working_hours || "",
      place_of_work: c.place_of_work || "",
    });
    setBody(c.body_md || "");
  }, [c]);

  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const terms = React.useCallback(
    () => ({
      title: f.title || undefined,
      language: f.language === "fr" ? ("fr" as const) : ("en" as const),
      professional_category: f.professional_category || undefined,
      job_title: f.job_title || undefined,
      effective_on: f.effective_on || undefined,
      end_on: f.end_on || undefined,
      gross_salary: numOrUndef(f.gross_salary),
      salary_currency: f.salary_currency || undefined,
      probation_months: numOrUndef(f.probation_months),
      notice_days: numOrUndef(f.notice_days),
      working_hours: f.working_hours || undefined,
      place_of_work: f.place_of_work || undefined,
    }),
    [f],
  );

  /* The review, recomputed as the terms settle. Debounced because it is a
     round trip per change and the answer for a half-typed salary is noise. */
  const settled = useDebounced(f, 600);
  React.useEffect(() => {
    if (!contractId || !seeded.current) return;
    let live = true;
    api
      .reviewContractTerms(contractId, {
        language: settled.language === "fr" ? "fr" : "en",
        professional_category: settled.professional_category || undefined,
        job_title: settled.job_title || undefined,
        effective_on: settled.effective_on || undefined,
        end_on: settled.end_on || undefined,
        gross_salary: numOrUndef(settled.gross_salary || ""),
        probation_months: numOrUndef(settled.probation_months || ""),
        place_of_work: settled.place_of_work || undefined,
      })
      .then((r) => {
        if (!live) return;
        setReview(r.review || []);
        setReviewFailed(false);
      })
      .catch(() => {
        /* Not swallowed. The review is advisory, so a failed round trip must
           not redden a page somebody is drafting on — but "nothing to flag"
           and "we could not check" are different claims, and showing the
           first when the second is true is how a twenty-year term gets
           issued under a panel that looked content. */
        if (live) setReviewFailed(true);
      });
    return () => {
      live = false;
    };
  }, [contractId, settled]);

  const editor = useContractEditor({
    initialMd: c?.body_md,
    editable: !locked,
    onChange: setBody,
  });

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const row = await api.draftContract(contractId, terms());
      setReview(row.review || []);
      setBody(row.body_md || "");
      // Remount the editor on the drafted text. Setting content through the
      // instance would leave the undo stack holding a document the user never
      // typed, so "undo" after a redraft would walk back into the old one.
      seeded.current = null;
      await contract.reload();
      setRevision((n) => n + 1);
      toast.success(tr("Drafted."));
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
      const { title, ...rest } = terms();
      await api.updateContract(contractId, {
        ...rest,
        // The wording, title included, only travels while the contract is a
        // DRAFT. Past that the server refuses it, and sending it back
        // unchanged would make every "record the terms" save depend on the
        // text round-tripping byte for byte.
        ...(locked ? {} : { title, body_md: body }),
      });
      await Promise.all([contract.reload(), dossier.reload()]);
      setRevision((n) => n + 1);
      toast.success(tr("Saved."));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function renew() {
    const ok = await confirm({
      title: tr("Renew this contract?"),
      body: tr(
        "A new draft is created carrying these terms. This contract stays as it is and is marked as replaced.",
      ),
      confirmLabel: tr("Create the renewal"),
      cancelLabel: tr("Cancel"),
    });
    if (!ok) return;
    setBusy("renew");
    try {
      const next = await api.renewContract(contractId, {});
      navigate(`/hr/contracts/${next.hr_contract_id}`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (contract.error) {
    return (
      <section className={`${pageShell.wide} space-y-4`}>
        <ErrorState message={contract.error} />
      </section>
    );
  }

  const heading = c ? KIND_LABEL[c.kind || ""] || c.title || tr("Contract") : tr("Contract");

  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div className="micro">
        <Link to="/hr/contracts" className="text-muted-foreground hover:text-foreground">
          ← {tr("Contracts")}
        </Link>
      </div>

      {/* No PageHeader: the document's own name is this page's h1. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{heading}</h1>
          <p className="micro">
            {[c?.employee_name, c?.doc_number].filter(Boolean).join(" · ") || " "}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c && <Pill tone={STATUS_TONE[c.status] || "mute"}>{c.status}</Pill>}
          <Button
            size="sm"
            variant="outline"
            loading={busy === "draft"}
            disabled={locked || !c}
            onClick={draft}
          >
            {body ? tr("Redraft with AI") : tr("Draft with AI")}
          </Button>
          <Button size="sm" variant="outline" disabled={!c} onClick={renew} loading={busy === "renew"}>
            {tr("Renew")}
          </Button>
          <Button size="sm" loading={busy === "save"} disabled={!c} onClick={save}>
            {tr("Save")}
          </Button>
        </div>
      </div>

      {locked && (
        /* The TEXT is frozen; the TERMS are not. Rewriting the wording of a
           signed contract is rewriting history — a renewal supersedes it. But
           every contract signed before this feature existed has no notice
           period and no probation date on the row, and typing in what the
           signed paper already says is not amending anything. */
        <Callout tone="info" title={tr("This contract is issued")}>
          Its wording is fixed. Supersede it with a renewal to change that. You can still record
          the terms it states, so probation and expiry are watched and payroll knows the notice
          period.
        </Callout>
      )}
      {error && <ErrorState message={error} />}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        {/* ── the terms ───────────────────────────────────────────────── */}
        <Panel title={tr("Agreed Terms")}>
          {contract.loading && !c ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <div className="flex flex-col gap-3">
              <Field label={tr("Title")} hint={locked ? "Fixed once the contract is issued." : undefined}>
                <Input value={f.title || ""} disabled={locked} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field
                label={tr("Language")}
                about="The contract is written and printed in this language. It is not a print setting: the clauses are stored in the language you pick, so changing it means drafting the text again."
              >
                <Select value={f.language || "en"} disabled={locked} onChange={(e) => set("language", e.target.value)}>
                  <option value="en">{tr("English")}</option>
                  <option value="fr">{tr("French")}</option>
                </Select>
              </Field>
              <Field label={tr("Job Title")}>
                <Input value={f.job_title || ""} onChange={(e) => set("job_title", e.target.value)} />
              </Field>
              <Field
                label={tr("Professional Category")}
                about="The category and step under the collective agreement covering your sector. The notice period, the leave entitlement and the minimum wage are all read off it, and a Cameroonian contract is expected to state it."
              >
                <Input
                  value={f.professional_category || ""}
                  onChange={(e) => set("professional_category", e.target.value)}
                  placeholder="Cadre, category 10, step A"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("Starts")}>
                  <DateField value={f.effective_on || ""} onChange={(iso) => set("effective_on", iso)} />
                </Field>
                <Field label={tr("Ends")} hint="Leave blank for an indefinite term.">
                  <DateField value={f.end_on || ""} onChange={(iso) => set("end_on", iso)} />
                </Field>
                <Field label="Gross Monthly">
                  <Input
                    type="number"
                    min="0"
                    className="num text-right"
                    value={f.gross_salary || ""}
                    onChange={(e) => set("gross_salary", e.target.value)}
                  />
                </Field>
                <Field label={tr("Currency")}>
                  <Select value={f.salary_currency || "XAF"} onChange={(e) => set("salary_currency", e.target.value)}>
                    <option value="XAF">{tr("XAF")}</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
                <Field label="Probation (Months)">
                  <Input
                    type="number"
                    min="0"
                    max="24"
                    className="num text-right"
                    value={f.probation_months || ""}
                    onChange={(e) => set("probation_months", e.target.value)}
                  />
                </Field>
                <Field label="Notice (Days)">
                  <Input
                    type="number"
                    min="0"
                    max="365"
                    className="num text-right"
                    value={f.notice_days || ""}
                    onChange={(e) => set("notice_days", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Working Hours">
                <Input
                  value={f.working_hours || ""}
                  onChange={(e) => set("working_hours", e.target.value)}
                  placeholder="08:00 to 17:00, Monday to Friday"
                />
              </Field>
              <Field label="Place of Work">
                <Input value={f.place_of_work || ""} onChange={(e) => set("place_of_work", e.target.value)} />
              </Field>
              {c?.probation_ends_on && (
                <p className="text-xs text-muted-foreground">
                  Probation ends{" "}
                  <span className="num text-foreground">{dateFmt(c.probation_ends_on)}</span>. You
                  will be warned before it does.
                </p>
              )}
            </div>
          )}
        </Panel>

        {/* ── the document ────────────────────────────────────────────── */}
        <div className="flex min-h-[70vh] min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Local state, not a URL tab: this is a way of looking at one
                  record, not a place you would send somebody to. */}
              {(["text", "paper"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn("chip", view === v && "on")}
                >
                  {v === "text" ? tr("Contract Text") : tr("Printed Preview")}
                </button>
              ))}
              {c?.body_md ? (
                <Pill tone={c.ai_generated ? "blue" : "mute"}>
                  {c.ai_generated ? `${tr("Drafted by")} ${c.ai_model}` : tr("Written clauses")}
                </Pill>
              ) : null}
            </div>
          </div>

          {view === "text" ? (
            contract.loading && !c ? (
              <Skeleton className="h-[70vh] w-full rounded-lg" />
            ) : (
              /* Keyed on the contract AND on the revision: a redraft replaces
                 the whole document, and feeding that through the live instance
                 would leave undo walking back into text the user never
                 typed. */
              <ContractTextEditor
                key={`${contractId}:${revision}`}
                editor={editor}
                readOnly={locked}
              />
            )
          ) : (
            <ContractPaper id={contractId} revision={revision} />
          )}
        </div>

        {/* ── the record's context ────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel title={tr("Review")}>
            {review.length ? (
              <ul className="space-y-2">
                {review.map((w) => (
                  <li key={w.code} className="flex gap-2 text-sm">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            ) : reviewFailed ? (
              <p className="micro">These terms could not be checked. Save and reopen to try again.</p>
            ) : (
              <p className="micro">Nothing to flag.</p>
            )}
          </Panel>

          <Panel title={tr("Signatures")}>
            {dossier.loading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <SignaturePanel signatures={dossier.data?.signatures || []} />
            )}
          </Panel>

          <Panel title={tr("History")}>
            {dossier.loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ChainPanel
                chain={dossier.data?.chain || []}
                currency={c?.salary_currency || "XAF"}
              />
            )}
          </Panel>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}

export default ContractPage;

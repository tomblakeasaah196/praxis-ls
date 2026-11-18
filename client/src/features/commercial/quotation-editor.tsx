/**
 * The quotation editor: one page at /sales/quotations/<id>
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §3.9; owner decisions D6, D7).
 *
 *   Top bar   the Full Proposal | Commercial Extract switch, the language
 *             (EN, FR, Both), the template, and Send.
 *   Left      the price lines (today's engine), then the sections.
 *   Right     the live preview: the ONE render the public page and the PDF
 *             also show, so the three cannot disagree. On a phone the preview
 *             is a Preview button.
 *
 * The switch changes which sections print, never a number: it is stored as the
 * quotation's default output and passed to the preview, and nothing else reads
 * it. Only a DRAFT is edited; a sent quotation is revised into a new version.
 *
 * Record Acceptance, Revise and Revoke are irreversible, so each goes through a
 * `useConfirm()` whose body says what it does.
 */
import * as React from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { QuotationLanguage, QuotationOutput, QuotationSectionInput, QuotationSectionKey } from "@shared";
import { transitionActions } from "@praxis/shared";
import { tr, tv } from "@/lib/i18n";
import { pageShell } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Segmented } from "@/components/ui/segmented";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { AccessLink } from "@/components/ui/access-link";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { useIsDesktop } from "@/lib/use-media-query";
import { useCan, useCanMove } from "@/lib/route-access";
import { dateFmt, money } from "@/lib/format";
import { errMsg, useResource } from "@/lib/use-resource";
import {
  convertQuotation,
  downloadQuotationPdf,
  draftQuotationSections,
  getQuotation,
  listTemplates,
  quotationHref,
  recordAcceptance,
  reviseQuotation,
  revokeQuotationLink,
  shareQuotation,
  updateQuotation,
  type Quotation,
  type QuotationPatch,
} from "@/lib/quotation-api";
import { requestHref } from "@/features/sales/old-links";
import { ImportCostingDialog, LinesEditor, MarginWarning } from "./quotation-lines";
import { cleanLines, partyName, toQLine, useCopy, type QLine } from "./quotation-model";
import { SectionsEditor } from "./quotation-sections";
import { DeclineDialog, PreviewDialog, PreviewFrame, SendDialog, ViewsDialog } from "./quotation-dialogs";
import { LANGUAGE_OPTIONS, OUTPUT_OPTIONS, TEMPLATE_TEXT_SECTIONS, statusLabel, statusTone } from "./quotation-words";

type Lang = "EN" | "FR";
type DialogKind = null | "send" | "decline" | "views" | "preview" | "import";

/** `/sales/quotations/<id>`. A placeholder id from an old link goes back to the list. */
export function QuotationEditorPage() {
  const { quotationId = "" } = useParams();
  // @access:open a malformed id goes back to the list this editor belongs to, under the same MOD-27 grant that opened it
  if (!/^[0-9a-f-]{36}$/i.test(quotationId)) return <Navigate to="/sales/quotations" replace />;
  return <QuotationEditor key={quotationId} id={quotationId} />;
}

function QuotationEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const can = useCan("MOD-27");
  const mayMove = useCanMove("MOD-27", transitionActions.quotationTransition);
  const [confirm, confirmDialog] = useConfirm();
  const copy = useCopy();
  const templates = useResource(listTemplates, []);

  const [q, setQ] = React.useState<Quotation | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<QLine[]>([]);
  const [linesDirty, setLinesDirty] = React.useState(false);
  const [familyOrder, setFamilyOrder] = React.useState<string[] | null>(null);
  const [output, setOutput] = React.useState<QuotationOutput>("FULL");
  const [previewLang, setPreviewLang] = React.useState<Lang>("EN");
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [drafting, setDrafting] = React.useState<QuotationSectionKey | null>(null);
  const chain = React.useRef<Promise<void>>(Promise.resolve());

  /** Take the stored quotation as the truth: lines, families, switch and language. */
  const adopt = React.useCallback((next: Quotation) => {
    setQ(next);
    setLines((next.lines || []).map(toQLine));
    setLinesDirty(false);
    setFamilyOrder(Array.isArray(next.family_order) && next.family_order.length ? next.family_order : null);
    setOutput(next.default_output === "EXTRACT" ? "EXTRACT" : "FULL");
    setPreviewLang((l) => (next.languages?.includes(l) ? l : (next.languages?.[0] as Lang) || "EN"));
  }, []);

  const load = React.useCallback(async () => {
    try {
      adopt(await getQuotation(id));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id, adopt]);
  React.useEffect(() => {
    void load();
  }, [load]);

  /** One PATCH at a time, in order; lines dirty on screen stay unless this save carries them. */
  const save = React.useCallback(
    (patch: QuotationPatch) => {
      const run = async () => {
        setSaving("saving");
        setSaveError(null);
        try {
          const out = await updateQuotation(id, patch);
          setQ(out);
          if (patch.lines) {
            setLines((out.lines || []).map(toQLine));
            setLinesDirty(false);
          }
          setSaving("saved");
        } catch (e) {
          setSaving("error");
          setSaveError(errMsg(e));
        }
      };
      chain.current = chain.current.then(run, run);
      return chain.current;
    },
    [id],
  );

  if (error && !q) {
    return (
      <section className={pageShell.wide}>
        <ErrorState message={error} />
      </section>
    );
  }
  if (!q) return <LoadingRow label={tr("Loading quotation…")} />;

  const status = q.status || "DRAFT";
  const editable = status === "DRAFT" && can("edit");
  const party = partyName(q);
  const ccy = q.currency || "XAF";
  const stamp = `${q.updated_at || ""}|${q.total_ttc}|${status}`;
  const superseded = Boolean(q.superseded_at);
  const offered = q.languages && q.languages.length ? q.languages : (["EN", "FR"] as Lang[]);
  const servicesTotal = lines.filter((l) => !l.is_disbursement).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function pickOutput(v: QuotationOutput) {
    setOutput(v);
    if (editable) void save({ default_output: v });
  }

  async function pickTemplate(templateId: string) {
    const t = (templates.data || []).find((x) => x.template_id === templateId);
    if (!t || !q) return;
    const ok = await confirm({
      title: tv("Apply the {{name}} template?", { name: t.name }),
      body: tr("Its sections are switched on or off as it says, and its words replace those in Our Solution, Scope of Services and Terms. The lines do not change."),
      confirmLabel: tr("Apply Template"),
      cancelLabel: tr("Keep These Words"),
    });
    if (!ok) return;
    const sections: QuotationSectionInput[] = (Object.keys(t.sections) as QuotationSectionKey[])
      .filter((k) => k !== "pricing")
      .map((k) => {
        const s = t.sections[k];
        const row: QuotationSectionInput = { section_key: k, enabled: s.enabled !== false };
        if (TEMPLATE_TEXT_SECTIONS.includes(k)) {
          row.body_en = s.body_en || null;
          row.body_fr = s.body_fr || null;
        }
        return row;
      });
    await save({ template_id: templateId, sections });
  }

  async function onDraftAi(key: QuotationSectionKey) {
    setDrafting(key);
    try {
      const out = await draftQuotationSections(id, [key as "needs" | "solution"]);
      if (out.manual_required) toast.info(tr("The AI could not draft it; the discovery notes are in the box to edit."));
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDrafting(null);
    }
  }

  async function onAccept() {
    if (!q) return;
    const ok = await confirm({
      title: tv("Record acceptance of {{number}}?", { number: q.doc_number || tr("this quotation") }),
      body: [
        `${tr("Opens operations file for")} ${party}.`,
        q.client_id ? "" : tv("Makes {{company}} a client.", { company: party }),
        tr("The request is marked Won. This cannot be undone."),
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: tr("Record Acceptance"),
      cancelLabel: tr("Not Yet"),
    });
    if (!ok) return;
    await act(() => recordAcceptance(id, {}), tr("Acceptance recorded"));
  }

  async function onRevise() {
    if (!q) return;
    const ok = await confirm({
      title: tv("Revise {{number}} into version {{next}}?", { number: q.doc_number || tr("this quotation"), next: (q.version || 1) + 1 }),
      body: tr("A draft copy opens with the same lines and sections. Sending it withdraws this version and its link."),
      confirmLabel: tr("Revise Quotation"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await reviseQuotation(id);
      navigate(quotationHref(next.quotation_id));
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  }

  async function onRevoke() {
    if (!q) return;
    const ok = await confirm({
      title: tr("Revoke the link?"),
      body: `${party}: ${tr("the link stops working at once, for everyone who has it.")}`,
      confirmLabel: tr("Revoke Link"),
      cancelLabel: tr("Keep It"),
      destructive: true,
    });
    if (!ok) return;
    await act(() => revokeQuotationLink(id), tr("Link revoked"));
  }

  async function onCopyLink() {
    if (!q) return;
    // The token is shown once and stored only as a hash, so copying a link
    // means making a new one, which retires the one already sent.
    if (q.share_active) {
      const ok = await confirm({
        title: tr("Make a new link?"),
        body: tr("The new link is copied, and the one already sent stops working."),
        confirmLabel: tr("Make New Link"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const out = await shareQuotation(id);
      await copy(out.url);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const canSend = (status === "DRAFT" || status === "SENT") && !superseded && mayMove("SENT");
  const answerable = status === "SENT" && !superseded;
  const sendButton = canSend ? (
    <Button size="sm" disabled={linesDirty || busy} title={linesDirty ? tr("Save the lines first") : undefined} onClick={() => setDialog("send")}>
      {status === "SENT" ? tr("Send Again") : tr("Send")}
    </Button>
  ) : null;

  const menu = (
    <MoreMenu label={tr("Quotation actions")}>
      <DropdownItem onSelect={() => void downloadQuotationPdf(id, output, previewLang, q.doc_number || "quotation").catch((e) => toast.error(errMsg(e)))}>
        {tr("Download PDF")}
      </DropdownItem>
      {!isDesktop ? <DropdownItem onSelect={() => setDialog("preview")}>{tr("Preview")}</DropdownItem> : null}
      {q.sent_at ? <DropdownItem onSelect={() => setDialog("views")}>{tr("Views")}</DropdownItem> : null}
      {status === "SENT" && !superseded && can("edit") ? <DropdownItem onSelect={() => void onCopyLink()}>{tr("Copy Link")}</DropdownItem> : null}
      {answerable && can("approve") ? <DropdownItem onSelect={() => void onAccept()}>{tr("Record Acceptance")}</DropdownItem> : null}
      {answerable && mayMove("REJECTED") ? <DropdownItem onSelect={() => setDialog("decline")}>{tr("Record Decline")}</DropdownItem> : null}
      {["SENT", "REJECTED", "EXPIRED"].includes(status) && !q.open_revision_id && can("create") ? (
        <DropdownItem onSelect={() => void onRevise()}>{tr("Revise")}</DropdownItem>
      ) : null}
      {status === "ACCEPTED" && can("edit") ? (
        <DropdownItem onSelect={() => void act(() => convertQuotation(id), tr("Invoice draft created"))}>{tr("Create Invoice Draft")}</DropdownItem>
      ) : null}
      {q.share_active && can("edit") ? (
        <DropdownItem destructive onSelect={() => void onRevoke()}>
          {tr("Revoke Link")}
        </DropdownItem>
      ) : null}
    </MoreMenu>
  );

  const left = (
    <div className="min-w-0 space-y-4">
      {superseded ? <Callout tone="warn" title={tr("A newer version has been sent.")}>{tr("This version is withdrawn and its link no longer opens.")}</Callout> : null}
      {q.open_revision_id ? (
        <Callout tone="info" title={tr("A revision is being drafted.")}>
          <AccessLink to={quotationHref(q.open_revision_id)} className="text-primary-ink underline">
            {tr("Open the Revision")}
          </AccessLink>
        </Callout>
      ) : null}
      {status === "REJECTED" && q.decline_reason ? <Callout tone="warn" title={tr("Declined.")}>{q.decline_reason}</Callout> : null}
      {status === "ACCEPTED" && q.answered_by_name ? (
        <Callout tone="ok" title={tr("Accepted.")}>
          {[q.answered_by_name, q.answered_by_email, dateFmt(q.answered_at)].filter(Boolean).join(" · ")}
        </Callout>
      ) : null}

      <section className="lux-card space-y-3 p-4" aria-labelledby="q-details">
        <h2 id="q-details" className="text-base font-semibold">{tr("Details")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Title")}>
            <Input defaultValue={q.title || ""} readOnly={!editable} maxLength={200} onBlur={(e) => editable && e.target.value !== (q.title || "") && void save({ title: e.target.value.trim() || null })} />
          </Field>
          <Field label={tr("Valid Until")}>
            <DateField value={q.valid_until ? String(q.valid_until).slice(0, 10) : ""} disabled={!editable} onChange={(v) => void save({ valid_until: v || null })} />
          </Field>
          <Field label={tr("Currency")}>
            <Input defaultValue={ccy} readOnly={!editable} maxLength={3} onBlur={(e) => editable && e.target.value.trim().toUpperCase() !== ccy && void save({ currency: e.target.value.trim().toUpperCase() })} />
          </Field>
          <Field label={tr("Quote Model")}>
            <Select value={q.quote_model || "HT_ON_TOP"} disabled={!editable} onChange={(e) => void save({ quote_model: e.target.value as "HT_ON_TOP" | "TTC" })}>
              <option value="HT_ON_TOP">{tr("HT Plus VAT")}</option>
              <option value="TTC">{tr("TTC")}</option>
            </Select>
          </Field>
        </div>
      </section>

      <section className="lux-card space-y-3 p-4" aria-labelledby="q-lines">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="q-lines" className="text-base font-semibold">{tr("Pricing")}</h2>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("import")}>
                {tr("Import From Costing")}
              </Button>
            ) : null}
            {editable ? (
              <Button size="sm" disabled={!linesDirty} onClick={() => void save({ lines: cleanLines(lines), family_order: familyOrder })}>
                {tr("Save Lines")}
              </Button>
            ) : null}
          </div>
        </div>
        <MarginWarning
          marginPercent={q.margin_percent === null || q.margin_percent === undefined ? null : Number(q.margin_percent)}
          ownCostTotal={q.own_cost_total === null || q.own_cost_total === undefined ? null : Number(q.own_cost_total)}
          servicesTotal={servicesTotal}
          currency={ccy}
        />
        <LinesEditor
          lines={lines}
          onChange={(next) => {
            setLines(next);
            setLinesDirty(true);
          }}
          currency={ccy}
          readOnly={!editable}
          familyOrder={familyOrder}
          onFamilyOrder={(o) => {
            setFamilyOrder(o);
            setLinesDirty(true);
          }}
        />
        <div className="flex flex-col items-end gap-0.5 text-sm">
          <span className="text-muted-foreground">
            {tr("Saved Total HT")}: <span className="num">{money(q.total_ht, ccy)}</span>
          </span>
          <span className="font-semibold">
            {tr("Saved Total TTC")}: <span className="num">{money(q.total_ttc, ccy)}</span>
          </span>
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="q-sections">
        <h2 id="q-sections" className="text-base font-semibold">{tr("Sections")}</h2>
        <SectionsEditor
          sections={q.sections || []}
          output={output}
          readOnly={!editable}
          onSave={(patch) => void save({ sections: [patch] })}
          onDraftAi={editable ? (k) => void onDraftAi(k) : null}
          drafting={drafting}
        />
      </section>
    </div>
  );

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Quotations" to="/sales/quotations" />}
        title={`${q.doc_number || tr("Draft Quotation")}${q.version > 1 ? ` v${q.version}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>
            <Segmented label={tr("Output")} value={output} options={OUTPUT_OPTIONS.map((o) => ({ value: o.value, label: tr(o.label) }))} onChange={pickOutput} />
            <Segmented
              label={tr("Language")}
              value={(q.language || "BILINGUAL") as QuotationLanguage}
              options={LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.value === "BILINGUAL" ? tr(o.label) : o.label }))}
              onChange={(v) => editable && void save({ language: v })}
            />
            <Select
              aria-label={tr("Template")}
              value={q.template_id || ""}
              disabled={!editable || !templates.data}
              onChange={(e) => void pickTemplate(e.target.value)}
              className="h-9 w-44 py-0 text-sm"
            >
              <option value="" disabled>
                {tr("Template")}
              </option>
              {(templates.data || []).map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.is_default ? `★ ${t.name}` : t.name}
                </option>
              ))}
            </Select>
            {sendButton}
            {menu}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {q.lead ? (
          <AccessLink to={`/sales/leads/${q.lead.lead_id}`} whenDenied="text" className="font-medium text-primary-ink underline">
            {party}
          </AccessLink>
        ) : (
          <span className="font-medium text-foreground">{party}</span>
        )}
        {q.quote_request ? (
          <AccessLink to={requestHref(q.quote_request.lead_id, q.quote_request.quote_request_id)} whenDenied="text" className="text-primary-ink underline">
            {q.quote_request.public_ref || q.quote_request.title || tr("Request")}
          </AccessLink>
        ) : null}
        {q.costing ? (
          <AccessLink to={`/costing/costing/${q.costing.costing_id}`} whenDenied="text" className="text-primary-ink underline">
            {`${tr("Costing")} ${q.costing.doc_number || ""}`.trim()}
          </AccessLink>
        ) : null}
        {q.valid_until ? <span>{`${tr("Valid until")} ${dateFmt(q.valid_until)}`}</span> : null}
        {q.viewed_at ? <span>{`${tr("Viewed")} ${dateFmt(q.viewed_at)}`}</span> : q.sent_at ? <span>{tr("Not viewed yet")}</span> : null}
        <span className="ml-auto" role="status" aria-live="polite">
          {saving === "saving" ? tr("Saving…") : saving === "saved" ? tr("Saved") : ""}
        </span>
      </div>
      {saving === "error" && saveError ? <ErrorState message={saveError} /> : null}

      {isDesktop ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {left}
          <aside className="sticky top-4 space-y-2" aria-label={tr("Preview")}>
            {offered.length > 1 ? (
              <Segmented label={tr("Preview language")} value={previewLang} options={offered.map((l) => ({ value: l, label: l }))} onChange={(v) => setPreviewLang(v as Lang)} />
            ) : null}
            <PreviewFrame id={id} output={output} language={previewLang} stamp={stamp} />
          </aside>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <Button variant="outline" size="sm" onClick={() => setDialog("preview")}>
              {tr("Preview")}
            </Button>
          </div>
          {left}
        </>
      )}

      <SendDialog
        open={dialog === "send"}
        onClose={() => setDialog(null)}
        q={q}
        output={output}
        language={previewLang}
        onSent={(r) => adopt(r.quotation)}
      />
      <DeclineDialog
        open={dialog === "decline"}
        onClose={() => setDialog(null)}
        q={q}
        onDone={() => {
          setDialog(null);
          toast.success(tr("Decline recorded"));
          void load();
        }}
      />
      <ViewsDialog open={dialog === "views"} onClose={() => setDialog(null)} q={q} />
      <PreviewDialog open={dialog === "preview"} onClose={() => setDialog(null)} id={id} output={output} language={previewLang} stamp={stamp} />
      <ImportCostingDialog
        open={dialog === "import"}
        onClose={() => setDialog(null)}
        onImport={(p) => {
          setDialog(null);
          void save({
            lines: cleanLines(p.lines.map(toQLine)),
            costing_id: p.costing.costing_id,
            margin_percent: p.target_margin_percent,
            family_order: familyOrder,
          });
        }}
      />
      {confirmDialog}
    </section>
  );
}

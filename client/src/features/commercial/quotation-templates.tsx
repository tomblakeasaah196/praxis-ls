/**
 * Quotation templates: the leanest builder (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.5, owner decision D8). Reached from the Templates button on Quotations,
 * at /sales/quotations/templates. Not a tab.
 *
 * Left: the templates, each with its name, its service types and a star on the
 * default. Right: the fixed section list, a switch per section (on by default
 * in a Full Proposal or not), and for Our Solution, Scope of Services and Terms
 * one text with EN | FR tabs. Preview renders it with sample data.
 *
 * Nothing else: no reordering, no custom sections, no merge fields, no images,
 * no fonts, no colours. The look is the tenant's branding. A quotation copies
 * a template's words when it is made, so editing one never changes a quotation
 * already made.
 */
import * as React from "react";
import { quotation as shared, type QuotationSectionKey } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { pageShell } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { SplitPane } from "@/components/ui/split-pane";
import { IndexRow } from "@/components/ui/index-row";
import { usePrompt } from "@/components/ui/use-prompt";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { useCan } from "@/lib/route-access";
import { errMsg, useResource } from "@/lib/use-resource";
import { quoteServices, serviceNameOf } from "@/lib/quote-request-api";
import { createTemplate, listTemplates, previewTemplate, updateTemplate, type QuotationTemplate } from "@/lib/quotation-api";
import { BilingualText } from "./quotation-sections";
import { ALWAYS_ON, SECTION_KEYS, TEMPLATE_TEXT_SECTIONS, sectionTitle } from "./quotation-words";

export function QuotationTemplatesPage() {
  const toast = useToast();
  const can = useCan("MOD-27");
  const editable = can("edit");
  const [prompt, promptDialog] = usePrompt();
  const [rows, setRows] = React.useState<QuotationTemplate[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const services = useResource(quoteServices, []);

  const load = React.useCallback(async () => {
    try {
      const list = await listTemplates();
      setRows(list);
      setError(null);
      setSelId((id) => id && list.some((t) => t.template_id === id) ? id : (list.find((t) => t.is_default) || list[0])?.template_id || null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Parameters<typeof updateTemplate>[1]) {
    const parsed = shared.templatePatch.safeParse(body);
    if (!parsed.success) {
      setSaving("error");
      setSaveError(parsed.error.issues[0]?.message || tr("Could not save it"));
      return;
    }
    setSaving("saving");
    setSaveError(null);
    try {
      const out = await updateTemplate(id, parsed.data);
      // Starring one unstars the others on the server: read them all again.
      if (body.is_default) await load();
      else setRows((rs) => (rs || []).map((t) => (t.template_id === id ? out : t)));
      setSaving("saved");
    } catch (e) {
      setSaving("error");
      setSaveError(errMsg(e));
    }
  }

  async function newTemplate() {
    const name = await prompt({
      title: tr("New Template"),
      label: tr("Name"),
      validate: (v) => (v.trim() ? null : tr("Give the template a name.")),
      confirmLabel: tr("Create Template"),
    });
    if (!name) return;
    try {
      const t = await createTemplate({ name: name.trim() });
      await load();
      setSelId(t.template_id);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const sel = (rows || []).find((t) => t.template_id === selId) || null;
  const serviceName = (id: string) => {
    const s = (services.data || []).find((x) => x.service_type_id === id);
    return s ? serviceNameOf({ name_en: s.name_en, name_fr: s.name_fr }) : "";
  };

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Quotations" to="/sales/quotations" />}
        title={tr("Quotation Templates")}
        description={tr("What a new quotation starts with: which sections a Full Proposal prints, and the words of Our Solution, Scope of Services and Terms in English and French.")}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!sel} onClick={() => setPreview(true)}>
              {tr("Preview")}
            </Button>
            {/* POST /quotations/templates is guarded with MOD-27 edit. */}
            {can("edit") ? (
              <Button size="sm" onClick={() => void newTemplate()}>
                {tr("New Template")}
              </Button>
            ) : null}
          </div>
        }
      />
      {error && !rows ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title={tr("No templates yet")} />
      ) : (
        <SplitPane
          storageKey="sales.quotation-templates"
          label={tr("Template list width")}
          defaultSize={300}
          min={220}
          max={440}
          activeKind={tr("Template")}
          active={!!selId}
          onClose={() => setSelId(null)}
          sheetTitle={sel?.name || tr("Template")}
        >
          <ul className="space-y-1 rounded-lg border p-1">
            {rows.map((t) => {
              const names = t.service_type_ids.map(serviceName).filter(Boolean);
              return (
                <li key={t.template_id}>
                  <IndexRow selected={t.template_id === selId} onClick={() => setSelId(t.template_id)} className="flex-col items-start gap-0.5">
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      {t.is_default ? (
                        <span className="text-primary-ink" role="img" aria-label={tr("Default")}>
                          ★
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{names.length ? names.join(", ") : tr("Any Service")}</span>
                  </IndexRow>
                </li>
              );
            })}
          </ul>

          {sel ? (
            <TemplateEditor
              key={sel.template_id}
              t={sel}
              editable={editable}
              services={(services.data || []).map((s) => ({ id: s.service_type_id, name: serviceNameOf({ name_en: s.name_en, name_fr: s.name_fr }) }))}
              saving={saving}
              saveError={saveError}
              onPatch={(body) => void patch(sel.template_id, body)}
            />
          ) : (
            <EmptyState title={tr("Pick a template")} />
          )}
        </SplitPane>
      )}
      {sel ? <TemplatePreview open={preview} onClose={() => setPreview(false)} id={sel.template_id} name={sel.name} /> : null}
      {promptDialog}
    </section>
  );
}

function TemplateEditor({
  t,
  editable,
  services,
  saving,
  saveError,
  onPatch,
}: {
  t: QuotationTemplate;
  editable: boolean;
  services: { id: string; name: string }[];
  saving: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  onPatch: (body: Parameters<typeof updateTemplate>[1]) => void;
}) {
  const [name, setName] = React.useState(t.name);
  React.useEffect(() => setName(t.name), [t.name]);
  const section = (key: QuotationSectionKey, body: { enabled?: boolean; body_en?: string | null; body_fr?: string | null }) =>
    onPatch({ sections: { [key]: body } });

  return (
    <div className="lux-card space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={tr("Name")} className="min-w-[14rem] flex-1">
          <Input value={name} readOnly={!editable} maxLength={120} onChange={(e) => setName(e.target.value)} onBlur={() => editable && name.trim() && name !== t.name && onPatch({ name: name.trim() })} />
        </Field>
        {t.is_default ? (
          <Pill tone="ok">{tr("Default")}</Pill>
        ) : editable ? (
          <Button size="sm" variant="outline" onClick={() => onPatch({ is_default: true })}>
            {tr("Make Default")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {saving === "saving" ? tr("Saving…") : saving === "saved" ? tr("Saved") : ""}
      </p>
      {saving === "error" && saveError ? <ErrorState message={saveError} /> : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{tr("Service Types")}</legend>
        {services.length === 0 ? (
          <p className="text-xs text-muted-foreground">{tr("No service types to pick from")}</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {services.map((s) => (
              <Checkbox
                key={s.id}
                checked={t.service_type_ids.includes(s.id)}
                disabled={!editable}
                label={s.name}
                onCheckedChange={(v) =>
                  onPatch({ service_type_ids: v ? [...t.service_type_ids, s.id] : t.service_type_ids.filter((x) => x !== s.id) })
                }
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{tr("Sections")}</h2>
        <ul className="space-y-2">
          {SECTION_KEYS.map((key) => {
            const s = t.sections[key] || { enabled: true };
            const always = ALWAYS_ON.includes(key);
            const on = always || s.enabled !== false;
            return (
              <li key={key} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  {always ? (
                    <span className="w-5" aria-hidden="true" />
                  ) : (
                    <Checkbox
                      checked={on}
                      disabled={!editable}
                      label={<span className="sr-only">{`${tr("Print")} ${sectionTitle(key)}`}</span>}
                      onCheckedChange={(v) => section(key, { enabled: v })}
                    />
                  )}
                  <h3 className={on ? "text-sm font-medium" : "text-sm font-medium text-muted-foreground"}>{sectionTitle(key)}</h3>
                  {always ? <Pill tone="mute">{tr("Always On")}</Pill> : null}
                </div>
                {TEMPLATE_TEXT_SECTIONS.includes(key) ? (
                  <div className="mt-2">
                    <BilingualText
                      sectionKey={key}
                      en={s.body_en}
                      fr={s.body_fr}
                      readOnly={!editable}
                      onSave={(lang, text) => section(key, { [lang === "en" ? "body_en" : "body_fr"]: text.trim() ? text : null })}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Preview with sample data (§3.5): the one quotation template, printing this template's sections. */
function TemplatePreview({ open, onClose, id, name }: { open: boolean; onClose: () => void; id: string; name: string }) {
  const [lang, setLang] = React.useState<"EN" | "FR">("EN");
  const res = useResource(() => (open ? previewTemplate(id, lang) : Promise.resolve(null)), [open, id, lang]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tv("Preview of {{name}}", { name })}
      size="wide"
      headerRight={<Segmented label={tr("Preview language")} value={lang} options={[{ value: "EN", label: "EN" }, { value: "FR", label: "FR" }]} onChange={setLang} />}
    >
      {res.error ? (
        <ErrorState message={res.error} />
      ) : !res.data ? (
        <LoadingRow />
      ) : (
        <iframe title={tr("Template preview")} srcDoc={res.data.html} sandbox="" className="h-[75vh] w-full rounded border bg-background" />
      )}
    </Dialog>
  );
}

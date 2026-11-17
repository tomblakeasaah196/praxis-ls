/**
 * Setup → Company Mail → Signatures. The company's signature: one layout and
 * one motto.
 *
 * ── ONE ROW, WHERE THERE WAS A LIST OF EIGHT ────────────────────────────────
 *
 * This section used to list every signature template: three company layouts,
 * four department copies of the classic one, and Formal / legal for Finance,
 * each with its own Motto button and some with Make Default. The tenant's
 * question on 17 Nov 2026 was "what are all of these? What do we need it for?",
 * and the honest answer was that two of the things on that screen did something
 * a company needs: choosing the layout, and writing the motto.
 *
 * So that is the screen. The layout is one dropdown. The motto is one line and
 * one Edit button, and it belongs to the company rather than to a template: the
 * server carries it across when the layout changes.
 *
 * ── WHAT IS NOT OFFERED, AND WHY ────────────────────────────────────────────
 *
 * The four "Classic — <department>" rows are not layouts. They are copies of
 * the classic layout that existed to give a department its own default, and a
 * department no longer chooses a signature (see `defaultTemplate` in
 * signature.repo.js). Offering them would be four entries that all draw the
 * same card. Formal / legal IS offered: it is a different layout, and a company
 * that wants its registration lines on every signature can choose it.
 *
 * ── COLOURS ARE NOT HERE ────────────────────────────────────────────────────
 *
 * The card takes its colours from Appearance: one brand, set once. Which brand
 * colour paints which part of the card is `<AccentRoles>`, opened from this
 * section's menu as Card Colours.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { useDeepLinkEdit, useFieldHighlight } from "@/lib/use-url-tab";
import { useToast } from "@/components/ui/toast";
import { useCan } from "@/lib/route-access";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { companyLayout, companyLayouts } from "./layouts";

/**
 * THE MOTTO / SLOGAN EDITOR.
 *
 * WHY IT HAD TO EXIST BEFORE THE DEEP LINK COULD. The card renders a motto — the
 * script-face line across the bottom — and the signature already reported a
 * missing one as a gap pointing at this tab. There was nothing here to type it
 * into: the field existed in the seed data, in the renderer and in the gap
 * list, and in no screen. So the link was honest about the destination and the
 * destination could not help, which is the failure this whole change is about.
 *
 * PER LANGUAGE, because the card is bilingual and a French motto is not a
 * translation the product may invent. Blank clears it — "no motto" is a value.
 */
function MottoModal({
  template,
  onClose,
  onSaved,
}: {
  template: api.SignatureTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [en, setEn] = React.useState("");
  const [fr, setFr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api
      .getSignatureMotto(template.signature_template_id)
      .then((m) => {
        if (!live) return;
        setEn(m.en);
        setFr(m.fr);
        setLoaded(true);
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [template.signature_template_id]);

  // Runs once the inputs are actually in the document, so `?field=motto`
  // focuses the English box rather than finding nothing.
  useFieldHighlight([loaded]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveSignatureMotto(template.signature_template_id, { en, fr });
      toast.success(tr("Motto saved"));
      onSaved();
      onClose();
    } catch (err) {
      reportActionError(err);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Motto")}
      description={tr(
        "The line in the script face across the bottom of the card. Leave a language blank to show no motto there.",
      )}
    >
      <form className="space-y-4" onSubmit={save}>
        {error && <Callout tone="bad" title={tr("Could not save")}>{error}</Callout>}
        <Field label={tr("English")} data-field="motto">
          <Input
            value={en}
            onChange={(e) => setEn(e.target.value)}
            maxLength={120}
            placeholder="Moving cargo. Moving Africa."
          />
        </Field>
        <Field label={tr("French")} data-field="motto_fr">
          <Input
            value={fr}
            onChange={(e) => setFr(e.target.value)}
            maxLength={120}
            placeholder="Faire bouger le fret. Faire bouger l'Afrique."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {tr("Save motto")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TemplatesTab() {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const can = useCan("MOD-70");
  const { data, error, reload } = useResource(() => api.listSignatureTemplates(), []);
  const templates = React.useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const layouts = React.useMemo(() => companyLayouts(templates), [templates]);
  const current = React.useMemo(() => companyLayout(templates), [templates]);

  // `?edit=motto&row=<templateId>` — where a "no motto" signature gap lands.
  // The row it names is the template that drew that person's signature, which
  // is the company layout now, so it opens the same motto either way.
  const [motto, setMotto] = React.useState<api.SignatureTemplate | null>(null);
  const deepEdit = useDeepLinkEdit("motto");
  React.useEffect(() => {
    if (!deepEdit.open || !templates.length) return;
    const found =
      templates.find((t) => t.signature_template_id === deepEdit.row) || current;
    if (!found) return;
    setMotto(found);
    deepEdit.clear();
  }, [deepEdit, templates, current]);

  async function choose(id: string) {
    const tpl = layouts.find((t) => t.signature_template_id === id);
    if (!tpl || tpl.signature_template_id === current?.signature_template_id) return;
    const ok = await confirm({
      title: `${tr("Use")} “${tpl.name}” ${tr("for every signature?")}`,
      body: tr("Everyone's signature changes to this layout on their next email. The motto carries over."),
      confirmLabel: tr("Use this layout"),
      cancelLabel: tr("Keep the current one"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.updateSignatureTemplate(tpl.signature_template_id, { is_default: true });
      toast.success(tr("Signature layout updated"));
      reload();
    } catch (err) {
      reportActionError(err);
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (data === null) return <SkeletonTable />;

  const mottoText =
    (current && typeof current.copy_en?.motto === "string" && current.copy_en.motto) ||
    (current && typeof current.copy_fr?.motto === "string" && current.copy_fr.motto) ||
    "";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={tr("Layout")}>
        <Select
          value={current?.signature_template_id ?? ""}
          disabled={busy || layouts.length === 0 || !can("edit")}
          onChange={(e) => void choose(e.target.value)}
        >
          {/* Only when nothing is in force, which is a company with no default
              at all: say so in the control rather than show a layout as chosen
              that is not. */}
          {!current && <option value="">{tr("Choose a layout")}</option>}
          {layouts.map((t) => (
            <option key={t.signature_template_id} value={t.signature_template_id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={tr("Motto")}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm" title={mottoText || undefined}>
            {mottoText || <span className="text-muted-foreground">{tr("No motto")}</span>}
          </span>
          {can("edit") && (
            <Button
              size="sm"
              variant="outline"
              disabled={!current}
              onClick={() => current && setMotto(current)}
            >
              {tr("Edit Motto")}
            </Button>
          )}
        </div>
      </Field>

      {motto && (
        <MottoModal
          template={motto}
          onClose={() => setMotto(null)}
          onSaved={reload}
        />
      )}
      {confirmDialog}
    </div>
  );
}

export default TemplatesTab;

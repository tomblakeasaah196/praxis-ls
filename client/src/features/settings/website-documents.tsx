/**
 * Settings › Website › Trust Documents: the policies a procurement officer
 * reads before handing over cargo, and the privacy policy (14660,
 * doc/smartls-website/ENGINEERING_GUIDE.md PR 4).
 *
 * ── DRAFT AND PUBLISHED ARE TWO THINGS ────────────────────────────────────
 *
 * The fields on this screen are the DRAFT. Publish freezes a copy, and that
 * copy is what the website shows and what its PDF is printed from. Editing a
 * published document therefore changes nothing a visitor sees until it is
 * published again; the status pill says so (Changed since publishing).
 *
 * ── THE PRIVACY POLICY IS DRAFTED, NEVER PUBLISHED, BY THE PRODUCT ────────
 *
 * "Draft From Your Companies" writes an English and German draft from the
 * companies published on the website. A person reads it and presses Publish.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Pill, type Tone } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { useConfirm } from "@/components/ui/use-confirm";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { useCan } from "@/lib/route-access";
import * as api from "@/lib/site-brand-api";
import { WebsiteNav } from "./website-nav";

const STATUS: Record<api.DocumentStatus, { label: () => string; tone: Tone }> = {
  DRAFT: { label: () => tr("Draft"), tone: "mute" },
  PUBLISHED: { label: () => tr("Published"), tone: "ok" },
  CHANGED: { label: () => tr("Changed Since Publishing"), tone: "warn" },
};

const LANGS: { value: api.DocumentLang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

const BLANK: api.DocumentDraft = {
  doc_key: "",
  kind: "POLICY",
  sort_order: 100,
  title_en: "",
  summary_en: "",
  body_en: "",
  version_label: "1.0",
  effective_on: null,
  approved_by: "",
};

const titleOf = (d: Pick<api.SiteDocument, "title_en" | "title_fr" | "title_de" | "doc_key">) =>
  d.title_en || d.title_fr || d.title_de || d.doc_key;

/** "Quality Policy" → "quality-policy": the address a new document suggests. */
const slugOf = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function Editor({
  doc,
  onSaved,
  onClose,
}: {
  doc: api.SiteDocument | null;
  onSaved: (d: api.SiteDocument | null) => void;
  onClose: () => void;
}) {
  const creating = !doc;
  const [form, setForm] = React.useState<api.DocumentDraft>(() =>
    doc
      ? {
          doc_key: doc.doc_key,
          kind: doc.kind,
          sort_order: doc.sort_order,
          title_en: doc.title_en, title_fr: doc.title_fr, title_de: doc.title_de,
          summary_en: doc.summary_en, summary_fr: doc.summary_fr, summary_de: doc.summary_de,
          body_en: doc.body_en, body_fr: doc.body_fr, body_de: doc.body_de,
          version_label: doc.version_label,
          effective_on: doc.effective_on ? String(doc.effective_on).slice(0, 10) : null,
          approved_by: doc.approved_by,
        }
      : { ...BLANK },
  );
  const [lang, setLang] = React.useState<api.DocumentLang>("en");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const [keyTouched, setKeyTouched] = React.useState(!creating);

  const set = <K extends keyof api.DocumentDraft>(k: K, v: api.DocumentDraft[K]) => {
    setMessage(null);
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (creating && !keyTouched && k === "title_en") next.doc_key = slugOf(String(v || ""));
      return next;
    });
  };

  /** Blank strings travel as null, so "cleared" and "never written" are one state. */
  const payload = (): api.DocumentDraft => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) out[k] = typeof v === "string" ? v.trim() || null : v;
    if (creating) out.doc_key = String(form.doc_key || "").trim();
    return out as api.DocumentDraft;
  };

  async function save(): Promise<api.SiteDocument | null> {
    const body = payload();
    const found = api.checkDocument(body, creating);
    setErrors(found);
    if (Object.keys(found).length) return null;
    setBusy(true);
    setFailure(null);
    try {
      const saved = creating ? await api.createDocument(body) : await api.updateDocument(doc!.document_id, body);
      setMessage(tr("Draft saved. The website still shows the published copy until you publish."));
      onSaved(saved);
      return saved;
    } catch (e) {
      setFailure(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const saved = await save();
    if (!saved) return;
    const ok = await confirm({
      title: `${tr("Publish")} ${titleOf(saved)}?`,
      body: tr("Visitors will read this version on the website and can download it as a PDF. Later edits stay in draft until you publish again."),
      confirmLabel: tr("Publish"),
    });
    if (!ok) return;
    setBusy(true);
    setFailure(null);
    try {
      onSaved(await api.publishDocument(saved.document_id, true));
      setMessage(tr("Published. The website shows this version now."));
    } catch (e) {
      setFailure(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!doc) return;
    const ok = await confirm({
      title: `${tr("Take")} ${titleOf(doc)} ${tr("off the website?")}`,
      body: tr("Its page and its PDF stop being available, and any link to them shows the not-found page. The draft is kept."),
      confirmLabel: tr("Withdraw Document"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      onSaved(await api.publishDocument(doc.document_id, false));
      setMessage(tr("Withdrawn. The draft is kept."));
    } catch (e) {
      setFailure(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!doc) return;
    const ok = await confirm({
      title: `${tr("Delete")} ${titleOf(doc)}?`,
      body: tr("The draft is deleted for good. This cannot be undone."),
      confirmLabel: tr("Delete Document"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteDocument(doc.document_id);
      onSaved(null);
      onClose();
    } catch (e) {
      setFailure(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!doc) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.downloadPreviewPdf(doc, lang);
    } catch (e) {
      setFailure(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const t = (k: string) => (form as Record<string, string | null | undefined>)[k] ?? "";

  return (
    <SettingsCard
      title={creating ? tr("New Document") : titleOf(doc!)}
      action={doc ? <Pill tone={STATUS[doc.status].tone}>{STATUS[doc.status].label()}</Pill> : undefined}
    >
      {failure ? <Callout tone="bad" className="mb-4">{failure}</Callout> : null}
      {message ? <Callout tone="ok" className="mb-4">{message}</Callout> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label={tr("Address")}
          about={tr("The last part of the page's address, such as quality-policy. Change it only before publishing: a changed address breaks links people have saved.")}
        >
          <Input
            value={t("doc_key")}
            maxLength={60}
            disabled={busy || Boolean(doc && doc.published_at)}
            onChange={(e) => {
              setKeyTouched(true);
              set("doc_key", e.target.value);
            }}
          />
          {errors.doc_key ? <p role="alert" className="text-xs text-destructive">{errors.doc_key}</p> : null}
        </Field>
        <Field label={tr("Kind")}>
          <Segmented<api.DocumentKind>
            label={tr("Kind")}
            value={(form.kind as api.DocumentKind) || "POLICY"}
            options={[
              { value: "POLICY", label: tr("Policy") },
              { value: "LEGAL", label: tr("Legal") },
            ]}
            onChange={(v) => set("kind", v)}
          />
        </Field>
        <Field label={tr("Order")} about={tr("Lower numbers are listed first on the Trust and Compliance page.")}>
          <Input
            type="number"
            min={0}
            max={9999}
            value={String(form.sort_order ?? 100)}
            disabled={busy}
            onChange={(e) => set("sort_order", Number(e.target.value || 0))}
          />
        </Field>
        <Field label={tr("Version")}>
          <Input value={t("version_label")} maxLength={40} placeholder="1.0" disabled={busy} onChange={(e) => set("version_label", e.target.value)} />
        </Field>
        <Field label={tr("Effective From")}>
          <DateField
            value={t("effective_on")}
            disabled={busy}
            onChange={(iso) => set("effective_on", iso || null)}
          />
        </Field>
        <Field
          label={tr("Approved By")}
          about={tr("The role that approved the document, such as Managing Director. Printed on the page and the PDF. No signature is shown.")}
        >
          <Input value={t("approved_by")} maxLength={120} disabled={busy} onChange={(e) => set("approved_by", e.target.value)} />
        </Field>
      </div>

      <div className="mt-6">
        <Segmented<api.DocumentLang>
          label={tr("Language")}
          value={lang}
          options={LANGS}
          onChange={setLang}
        />
      </div>

      <div className="mt-4 grid gap-4">
        <Field label={tr("Title")}>
          <Input value={t(`title_${lang}`)} maxLength={160} disabled={busy} onChange={(e) => set(`title_${lang}` as keyof api.DocumentDraft, e.target.value)} />
          {errors[`title_${lang}`] ? <p role="alert" className="text-xs text-destructive">{errors[`title_${lang}`]}</p> : null}
        </Field>
        <Field
          label={tr("Summary")}
          about={tr("Two sentences shown under the title on the Trust and Compliance page and in search results.")}
        >
          <Textarea rows={2} value={t(`summary_${lang}`)} maxLength={600} disabled={busy} onChange={(e) => set(`summary_${lang}` as keyof api.DocumentDraft, e.target.value)} />
        </Field>
        <Field
          label={tr("Body")}
          about={tr("Plain text with light formatting: ## for a heading, - for a bullet, **bold**, *italic*, [a link](https://example.com). A line ending in two spaces keeps its line break.")}
        >
          <Textarea
            rows={22}
            className="font-mono text-[13px] leading-relaxed"
            value={t(`body_${lang}`)}
            maxLength={60000}
            disabled={busy}
            onChange={(e) => set(`body_${lang}` as keyof api.DocumentDraft, e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? tr("Saving…") : tr("Save Draft")}
        </Button>
        <Button variant="outline" onClick={() => void publish()} disabled={busy}>
          {doc && doc.status === "PUBLISHED" ? tr("Publish Again") : tr("Publish")}
        </Button>
        {doc ? (
          <Button variant="ghost" onClick={() => void preview()} disabled={busy}>
            {tr("Preview PDF")}
          </Button>
        ) : null}
        {doc && doc.published_at ? (
          <Button variant="ghost" onClick={() => void withdraw()} disabled={busy}>
            {tr("Withdraw")}
          </Button>
        ) : null}
        {doc && !doc.published_at ? (
          <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
            {tr("Delete")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {tr("Close")}
        </Button>
      </div>
      {confirmElement}
    </SettingsCard>
  );
}

export function WebsiteDocumentsPage() {
  const [docs, setDocs] = React.useState<api.SiteDocument[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | "new" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirm, confirmElement] = useConfirm();
  // The routes are guarded by MOD-29 `edit` (site_brand.routes.js).
  const can = useCan("MOD-29");

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setDocs(await api.listDocuments());
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function draftPrivacy() {
    const existing = (docs || []).find((d) => d.doc_key === "privacy-policy");
    if (existing) {
      const ok = await confirm({
        title: tr("Replace the Privacy Policy's Draft?"),
        body: tr("The English and German drafts are rewritten from your companies as they are recorded now. The published copy is not touched."),
        confirmLabel: tr("Replace Draft"),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const d = await api.draftPrivacy();
      await load();
      setOpen(d.document_id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const current = open && open !== "new" ? (docs || []).find((d) => d.document_id === open) || null : null;

  return (
    <>
      <PageHeader
        title={tr("Trust Documents")}
        description={tr(
          "Your policies and your privacy policy, as the website publishes them. Each has a draft you edit and a published copy visitors read and download as a PDF.",
        )}
        action={
          can("edit") && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void draftPrivacy()} disabled={busy}>
                {tr("Draft Privacy Policy")}
              </Button>
              <Button onClick={() => setOpen("new")} disabled={busy}>
                {tr("New Document")}
              </Button>
            </div>
          )
        }
      />
      <WebsiteNav />

      {error ? <ErrorState message={error} /> : null}

      <SettingsCard title={tr("Documents")}>
        {docs && !docs.length ? (
          <p className="text-sm text-muted-foreground">{tr("No documents yet.")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(docs || []).map((d) => (
              <li key={d.document_id} className="flex flex-wrap items-center gap-3 py-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm font-medium text-primary-ink hover:underline"
                  onClick={() => setOpen(d.document_id)}
                >
                  {titleOf(d)}
                </button>
                <span className="text-xs text-muted-foreground">
                  {d.kind === "LEGAL" ? tr("Legal") : tr("Policy")}
                  {d.version_label ? ` · v${d.version_label}` : ""}
                  {d.published_at ? ` · ${dateFmt(d.published_at)}` : ""}
                </span>
                <Pill tone={STATUS[d.status].tone}>{STATUS[d.status].label()}</Pill>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      {open ? (
        <Editor
          key={open}
          doc={current}
          onSaved={(d) => {
            void load();
            if (d && open === "new") setOpen(d.document_id);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {confirmElement}
    </>
  );
}

/**
 * Sales & CRM, Company Profile (guide §3.6, owner decision D9).
 *
 * One editor screen. The nine fixed sections sit on the left, each with its
 * on/off switch and a completeness dot; the selected section's fields sit on
 * the right with English and French side by side, saved as each one is left.
 * The header carries the version's status and the outputs: Preview, Download
 * PDF, History, Share, Publish.
 *
 * A published version is never edited. The first save after a publish opens
 * the next draft as a copy of it, on the server; this screen only shows which
 * version it is looking at.
 */
import * as React from "react";
import { companyProfile } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { pageShell } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { Pill } from "@/components/ui/pill";
import { SplitPane } from "@/components/ui/split-pane";
import { IndexRow } from "@/components/ui/index-row";
import { InfoHint } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingRow, EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { cn } from "@/lib/cn";
import { dateFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/company-profile-api";
import { SectionEditor, type SavePatch } from "./company-profile-sections";
import { ShareDialog } from "./company-profile-share";

const TITLES: Record<api.SectionKey, string> = {
  cover: "Cover",
  who_we_are: "Who We Are",
  services: "Services",
  capacity: "Capacity & Network",
  certifications: "Certifications & Memberships",
  case_stories: "Case Stories",
  clients: "Clients",
  why_us: "Why Choose Us",
  contact: "Contact",
};

const DOT_CLASS: Record<api.Dot, string> = {
  complete: "bg-ok-fill",
  partial: "bg-warn-fill",
  empty: "border border-muted-foreground/60 bg-transparent",
};
const DOT_LABEL: Record<api.Dot, string> = {
  complete: "Complete",
  partial: "Needs a Look",
  empty: "Empty",
};

const FIELD_LABEL: Record<string, string> = {
  on: "Shown", show: "Shown Fields", items: "Items", figures: "Figures",
  story_ids: "Stories", logo_ids: "Logos", image_key: "Cover Image",
  tagline: "Tagline", positioning: "Positioning", history: "Our Story", mission: "Our Mission", network: "Network Note",
};

function fieldLabel(field: string): string {
  if (FIELD_LABEL[field]) return tr(FIELD_LABEL[field]);
  if (field.endsWith(".title")) return tr("Promise");
  if (field.endsWith(".body")) return tr("Detail");
  return tr("Item Text");
}

function shortValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  if (Array.isArray(v)) return `${v.length} ${tr(v.length === 1 ? "item" : "items")}`;
  if (typeof v === "boolean") return v ? tr("On") : tr("Off");
  return tr("Changed");
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export function CompanyProfilePage() {
  const toast = useToast();
  const [editor, setEditor] = React.useState<api.Editor | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selKey, setSelKey] = React.useState<api.SectionKey | null>(null);
  const [lang, setLang] = React.useState<api.Lang>("EN");
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "preview" | "publish" | "history" | "share">(null);
  const [downloading, setDownloading] = React.useState(false);

  // The latest saved state, read by a save when it RUNS rather than when it was
  // queued, and the queue that keeps saves in order.
  const latest = React.useRef<api.Editor | null>(null);
  const chain = React.useRef<Promise<void>>(Promise.resolve());
  latest.current = editor;

  const load = React.useCallback(async () => {
    try {
      setEditor(await api.getEditor());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const save = React.useCallback(
    (key: api.SectionKey) => (patch: SavePatch) => {
      const run = async () => {
        const current = latest.current?.sections.find((s) => s.key === key);
        if (!current) return;
        const body: { structure?: api.Structure; text_en?: api.Words; text_fr?: api.Words } = {};
        if (patch.structure) {
          const next = { ...current.structure, ...patch.structure(current.structure) };
          body.structure = next;
        }
        if (patch.text_en) body.text_en = { ...current.text_en, ...patch.text_en };
        if (patch.text_fr) body.text_fr = { ...current.text_fr, ...patch.text_fr };
        // The shared schema first, so a refusal is said here and not by a 422.
        const parsed = companyProfile.section(key)?.safeParse(body);
        const structure = (body.structure || current.structure) as Record<string, unknown>;
        const limits = [body.text_en, body.text_fr]
          .filter(Boolean)
          .flatMap((words) => Object.values(companyProfile.cleanText(key, structure, words as api.Words).errors).flat());
        if ((parsed && !parsed.success) || limits.length) {
          setSaving("error");
          setSaveError((parsed && !parsed.success && parsed.error.issues[0]?.message) || limits[0] || tr("Could not save it"));
          return;
        }
        setSaving("saving");
        setSaveError(null);
        try {
          const out = await api.saveSection(key, body);
          setEditor((e) => {
            if (!e) return e;
            const known = e.versions.some((v) => v.version_id === out.draft.version_id);
            return {
              ...e,
              draft: out.draft,
              versions: known ? e.versions : [out.draft, ...e.versions],
              completeness: out.completeness,
              sections: e.sections.map((s) => (s.key === key ? out.section : s)),
            };
          });
          setSaving("saved");
        } catch (e) {
          setSaving("error");
          setSaveError(errMsg(e));
        }
      };
      chain.current = chain.current.then(run, run);
      return chain.current;
    },
    [],
  );

  if (error && !editor) {
    return (
      <section className={pageShell.wide}>
        <ErrorState message={error} />
      </section>
    );
  }
  if (!editor) return <LoadingRow />;

  const effective: api.SectionKey = selKey ?? "cover";
  const section = editor.sections.find((s) => s.key === effective)!;
  const showing = editor.draft || editor.published;
  const status = editor.draft
    ? `${tr("Draft")} v${editor.draft.number}`
    : editor.published
      ? `${tr("Published")} v${editor.published.number}`
      : tr("Not Published");

  async function downloadPdf() {
    setDownloading(true);
    try {
      await api.downloadPdf(lang, showing);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title={tr("Company Profile")}
        description={tr("Write each section once in English and French. Publish to make it what proposals, the PDF and shared links show.")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={editor.draft ? "warn" : editor.published ? "ok" : "mute"}>{status}</Pill>
            <Segmented label={tr("Output language")} value={lang} options={[{ value: "EN", label: "EN" }, { value: "FR", label: "FR" }]} onChange={setLang} />
            <Button variant="outline" size="sm" disabled={!showing} onClick={() => setDialog("preview")}>{tr("Preview")}</Button>
            <Button variant="outline" size="sm" disabled={!showing} loading={downloading} onClick={downloadPdf}>{tr("Download PDF")}</Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("history")}>{tr("History")}</Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("share")}>{tr("Share")}</Button>
            <Button size="sm" disabled={!editor.draft} onClick={() => setDialog("publish")}>{tr("Publish")}</Button>
          </div>
        }
      />
      <HubTabs />

      <SplitPane
        storageKey="sales.company-profile"
        label={tr("Section list width")}
        defaultSize={280}
        min={220}
        max={420}
        activeKind={tr("Section")}
        active={!!selKey}
        onClose={() => setSelKey(null)}
        sheetTitle={tr(TITLES[effective])}
      >
        <ul className="space-y-1 rounded-lg border p-1">
          {companyProfile.SECTION_KEYS.map((key) => {
            const s = editor.sections.find((x) => x.key === key)!;
            const dot = editor.completeness[key] || "empty";
            const on = s.structure.on !== false;
            return (
              <li key={key} className="flex items-center gap-1">
                {key === "cover" ? (
                  <span className="w-7 shrink-0" aria-hidden="true" />
                ) : (
                  <span className="shrink-0 pl-1">
                    <Checkbox
                      checked={on}
                      label={<span className="sr-only">{`${tr("Show")} ${tr(TITLES[key])}`}</span>}
                      onCheckedChange={(v) => void save(key)({ structure: () => ({ on: v }) })}
                    />
                  </span>
                )}
                <IndexRow
                  selected={effective === key}
                  onClick={() => setSelKey(key)}
                  className={cn("flex-1 items-center justify-between gap-2", !on && "text-muted-foreground")}
                >
                  <span className="truncate">{tr(TITLES[key])}</span>
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT_CLASS[dot])}
                    role="img"
                    aria-label={tr(DOT_LABEL[dot])}
                  />
                </IndexRow>
              </li>
            );
          })}
        </ul>

        <div className="lux-card space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold">{tr(TITLES[effective])}</h2>
              {section.structure.on === false ? <Pill tone="mute">{tr("Hidden")}</Pill> : null}
            </div>
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {saving === "saving" ? tr("Saving…") : saving === "saved" ? tr("Saved") : ""}
            </p>
          </div>
          {saving === "error" && saveError ? <ErrorState message={saveError} /> : null}
          <SectionEditor
            key={`${effective}:${editor.draft?.version_id || editor.published?.version_id || "none"}`}
            section={section}
            editor={editor}
            coverUrl={editor.cover_url}
            onSave={save(effective)}
            onReload={load}
            onCover={(url) => {
              setEditor((e) => (e ? { ...e, cover_url: url } : e));
              void load();
            }}
          />
        </div>
      </SplitPane>

      <PreviewDialog open={dialog === "preview"} onClose={() => setDialog(null)} lang={lang} onLang={setLang} />
      <PublishDialog
        open={dialog === "publish"}
        onClose={() => setDialog(null)}
        draft={editor.draft}
        published={editor.published}
        onPublished={async (v) => {
          setDialog(null);
          toast.success(`${tr("Published")} v${v.number}`);
          await load();
        }}
      />
      <HistoryDialog open={dialog === "history"} onClose={() => setDialog(null)} versions={editor.versions} lang={lang} />
      <ShareDialog open={dialog === "share"} onClose={() => setDialog(null)} published={editor.published} />
    </section>
  );
}

/* ── Preview ──────────────────────────────────────────────────────────────── */

function PreviewDialog({
  open,
  onClose,
  lang,
  onLang,
  versionId = null,
}: {
  open: boolean;
  onClose: () => void;
  lang: api.Lang;
  onLang: (l: api.Lang) => void;
  versionId?: string | null;
}) {
  const [html, setHtml] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setHtml(null);
    setError(null);
    api.preview(lang, versionId)
      .then((r) => alive && setHtml(r.html))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [open, lang, versionId]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Preview")}
      size="wide"
      headerRight={
        <Segmented label={tr("Preview language")} value={lang} options={[{ value: "EN", label: "EN" }, { value: "FR", label: "FR" }]} onChange={onLang} />
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : html === null ? (
        <LoadingRow />
      ) : (
        // Sandboxed with nothing allowed: this is the PDF's own HTML, shown.
        <iframe title={tr("Company profile preview")} srcDoc={html} sandbox="" className="h-[75vh] w-full rounded border bg-background" />
      )}
    </Dialog>
  );
}

/* ── Publish ──────────────────────────────────────────────────────────────── */

function PublishDialog({
  open,
  onClose,
  draft,
  published,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  draft: api.VersionSummary | null;
  published: api.VersionSummary | null;
  onPublished: (v: api.VersionSummary) => Promise<void>;
}) {
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setNote("");
      setError(null);
    }
  }, [open]);
  if (!draft) return null;
  async function go() {
    try {
      const v = await api.publish(note.trim() || null);
      await onPublished(v);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${tr("Publish")} v${draft.number}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Keep Editing")}</Button>
          <Button onClick={go}>{`${tr("Publish")} v${draft.number}`}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">
          {published
            ? tv("Links that follow the published version show v{{next}} from now on, and v{{prev}} moves to History. A published version is never edited again.", { next: draft.number, prev: published.number })
            : tr("A published version is never edited again. The next change opens a new draft.")}
        </p>
        <Field label={tr("Change Note")}>
          <Input value={note} maxLength={companyProfile.LIMITS.change_note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Dialog>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

const STATUS_TONE = { DRAFT: "warn", PUBLISHED: "ok", SUPERSEDED: "mute" } as const;
const STATUS_LABEL = { DRAFT: "Draft", PUBLISHED: "Published", SUPERSEDED: "Superseded" } as const;

function HistoryDialog({
  open,
  onClose,
  versions,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  versions: api.VersionSummary[];
  lang: api.Lang;
}) {
  const [sel, setSel] = React.useState<api.VersionSummary | null>(null);
  const [changes, setChanges] = React.useState<api.Change[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [previewLang, setPreviewLang] = React.useState<api.Lang>(lang);

  React.useEffect(() => {
    if (open) setSel(versions[0] || null);
  }, [open, versions]);
  React.useEffect(() => {
    if (!sel) return;
    let alive = true;
    setChanges(null);
    setError(null);
    api.versionDiff(sel.version_id)
      .then((r) => alive && setChanges(r.changes))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [sel]);

  return (
    <Dialog open={open} onClose={onClose} title={tr("History")} size="xl">
      {versions.length === 0 ? (
        <EmptyState title={tr("No versions yet")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <ul className="space-y-1">
            {versions.map((v) => (
              <li key={v.version_id}>
                <IndexRow selected={sel?.version_id === v.version_id} onClick={() => setSel(v)} className="flex-col items-start gap-0.5">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-medium">v{v.number}</span>
                    <Pill tone={STATUS_TONE[v.status]}>{tr(STATUS_LABEL[v.status])}</Pill>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.published_at ? dateFmt(v.published_at) : dateFmt(v.created_at)}
                  </span>
                </IndexRow>
              </li>
            ))}
          </ul>
          {sel ? (
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold">v{sel.number}</h3>
                  {sel.change_note ? (
                    <InfoHint label={tr("About this version")}>{sel.change_note}</InfoHint>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setPreviewLang(lang); setPreview(true); }}>{tr("Preview")}</Button>
                  <Button size="sm" variant="outline" onClick={() => void api.downloadPdf(lang, sel)}>{tr("Download PDF")}</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {sel.published_by_name ? `${tr("Published by")} ${sel.published_by_name}` : sel.created_by_name ? `${tr("Opened by")} ${sel.created_by_name}` : ""}
              </p>
              {error ? <ErrorState message={error} /> : changes === null ? <LoadingRow /> : changes.length === 0 ? (
                <EmptyState title={tr("No changes from the version before")} />
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {changes.map((c, i) => (
                    <li key={`${c.section_key}-${c.field}-${c.language}-${i}`} className="space-y-1 p-2">
                      <p className="font-medium">
                        {tr(TITLES[c.section_key])} · {fieldLabel(c.field)}
                        {c.language ? <span className="micro text-muted-foreground"> {c.language}</span> : null}
                      </p>
                      {shortValue(c.before) ? <p className="text-muted-foreground line-through">{shortValue(c.before)}</p> : null}
                      {shortValue(c.after) ? <p>{shortValue(c.after)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
      <PreviewDialog open={preview} onClose={() => setPreview(false)} lang={previewLang} onLang={setPreviewLang} versionId={sel?.version_id} />
    </Dialog>
  );
}

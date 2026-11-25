/**
 * Settings › Website › Photographs: every scene-setting picture on the public
 * site, one slot at a time (14660, doc/smartls-website/ENGINEERING_GUIDE.md
 * PR 4).
 *
 * ── WHY THIS IS NOT THE ASSET CONTROL IN website-assets.tsx ───────────────
 *
 * That control belongs to a ROW somebody is editing: this leader's portrait,
 * this partner's mark. These pictures belong to a PLACE on the site (the
 * second step on the homepage, the band under the About page's story), so the
 * screen is organised by page, the way an editor thinks about it.
 *
 * ── GENERATED IMAGERY IS ALLOWED HERE, AND ONLY HERE ──────────────────────
 *
 * Every slot on this screen is an atmosphere slot (13789): it pictures no
 * named person and no company's mark. A generated scene of a quay is honest
 * there. A portrait never is, which is why portraits are uploaded on the
 * leader, where `generated` is not offered and the API refuses it.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import { useConfirm } from "@/components/ui/use-confirm";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import { fileToDataUrl } from "@/lib/image-compress";
import * as api from "@/lib/site-brand-api";
import { WebsiteNav } from "./website-nav";

const PAGE_TITLE: Record<api.ImageSlot["page"], () => string> = {
  home: () => tr("Homepage"),
  about: () => tr("About Page"),
  partners: () => tr("For Partners Page"),
  trust: () => tr("Trust and Compliance Page"),
  services: () => tr("Service Families"),
};

const PAGE_ORDER: api.ImageSlot["page"][] = ["home", "about", "partners", "trust", "services"];

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** The smallest derivative there is, or the original: a thumbnail, not the
 *  2400 px picture, so the screen stays light with twenty slots on it. */
function thumbUrl(slot: api.ImageSlot): string | null {
  if (!slot.doc_id) return null;
  const v = slot.variants;
  const base = `/api/tenant/public/site/media/${encodeURIComponent(slot.doc_id)}`;
  if (v && v.widths.length && v.formats.includes("webp")) return `${base}/${v.widths[0]}.webp`;
  return base;
}

function SlotRow({
  slot,
  onChanged,
  confirm,
}: {
  slot: api.ImageSlot;
  onChanged: () => void;
  confirm: (o: { title: string; body?: React.ReactNode; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
}) {
  const [provenance, setProvenance] = React.useState<api.ImageProvenance>(
    slot.provenance || "generated",
  );
  const [altEn, setAltEn] = React.useState(slot.alt_en || "");
  const [altFr, setAltFr] = React.useState(slot.alt_fr || "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [savedAlt, setSavedAlt] = React.useState(false);
  const id = React.useId();
  const thumb = thumbUrl(slot);
  const altChanged = (altEn || "") !== (slot.alt_en || "") || (altFr || "") !== (slot.alt_fr || "");

  async function saveAlt() {
    setBusy(true);
    setErr(null);
    try {
      await api.saveImageAlt(slot.key, { alt_en: altEn.trim() || null, alt_fr: altFr.trim() || null });
      setSavedAlt(true);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: tr("Take This Photograph Off the Website?"),
      body: tr("The band shows no picture until another is uploaded. The file is archived, not deleted."),
      confirmLabel: tr("Remove Photograph"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await api.removeImage(slot.key);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-4 border-b border-[var(--border)] py-5 last:border-b-0 md:grid-cols-[200px_1fr]">
      <div className="space-y-2">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--muted)]">
          {thumb ? (
            <img src={thumb} alt={tr("Current photograph")} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {tr("No photograph")}
            </div>
          )}
        </div>
        <p className="micro">{`${tr(slot.label)} · ${slot.aspect}`}</p>
      </div>

      <div className="min-w-0 space-y-3">
        <Field
          label={tr("Where This Photograph Came From")}
          about={tr("A generated scene is fine in these bands: none of them shows a named person or another company's mark. Portraits are uploaded on the person, in About, and must be real photographs.")}
        >
          <select
            id={`${id}-prov`}
            className="h-9 w-full max-w-md rounded-md border border-input bg-card px-2 text-sm"
            value={provenance}
            disabled={busy}
            onChange={(e) => setProvenance(e.target.value as api.ImageProvenance)}
          >
            <option value="owned">{tr("Ours: we took it")}</option>
            <option value="licensed">{tr("Licensed: we have the right to use it")}</option>
            <option value="generated">{tr("Generated: an illustration of the scene")}</option>
          </select>
        </Field>

        <ImageUpload<{ doc_id: string }>
          profile="photo"
          accept="image/png,image/jpeg,image/webp"
          maxBytes={api.IMAGE_LIMITS.maxBytes}
          disabled={busy}
          label={slot.doc_id ? tr("Replace Photograph") : tr("Upload Photograph")}
          hint={`JPEG, PNG or WebP · ${slot.aspect} · ${api.IMAGE_LIMITS.minWidth} px wide or more · ${mb(api.IMAGE_LIMITS.maxBytes)} MB`}
          send={async (file, ctx) =>
            api.uploadImage(
              slot.key,
              {
                provenance,
                data_url: await fileToDataUrl(file),
                original_name: file.name,
                alt_en: altEn.trim() || null,
                alt_fr: altFr.trim() || null,
              },
              ctx.onProgress,
            )
          }
          onAllComplete={() => onChanged()}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={tr("Description (English)")}
            about={tr("What a screen reader says for the picture, and what a search engine reads. Describe the scene in a few words: a container quay at dusk, a truck on a laterite road.")}
          >
            <Input
              id={`${id}-alt-en`}
              value={altEn}
              maxLength={200}
              disabled={busy}
              onChange={(e) => {
                setSavedAlt(false);
                setAltEn(e.target.value);
              }}
            />
          </Field>
          <Field label={tr("Description (French)")}>
            <Input
              id={`${id}-alt-fr`}
              value={altFr}
              maxLength={200}
              disabled={busy}
              onChange={(e) => {
                setSavedAlt(false);
                setAltFr(e.target.value);
              }}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy || !altChanged} onClick={() => void saveAlt()}>
            {tr("Save Description")}
          </Button>
          {slot.doc_id ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              {tr("Remove Photograph")}
            </Button>
          ) : null}
          {savedAlt ? <span className="text-xs text-muted-foreground">{tr("Saved")}</span> : null}
        </div>

        {err ? (
          <p role="alert" className="text-xs text-destructive">
            {err}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function WebsiteImagesPage() {
  const [slots, setSlots] = React.useState<api.ImageSlot[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setSlots(await api.listImages());
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const groups = PAGE_ORDER.map((page) => ({
    page,
    slots: (slots || []).filter((s) => s.page === page),
  })).filter((g) => g.slots.length);

  return (
    <>
      <PageHeader
        title={tr("Website Photographs")}
        description={tr(
          "The pictures in the bands of your public pages, one slot at a time. Each is compressed in the browser and served as AVIF and WebP at three widths, so a phone downloads a fraction of the original.",
        )}
      />
      <WebsiteNav />

      {error ? <ErrorState message={error} /> : null}
      {slots && !groups.length ? (
        <Callout tone="info">{tr("There are no photograph slots on this website yet.")}</Callout>
      ) : null}

      {groups.map((g) => (
        <SettingsCard key={g.page} title={PAGE_TITLE[g.page]()}>
          <ul>
            {g.slots.map((slot) => (
              <SlotRow
                key={`${slot.key}-${slot.doc_id || "none"}-${slot.updated_at || ""}`}
                slot={slot}
                onChanged={() => void load()}
                confirm={confirm}
              />
            ))}
          </ul>
        </SettingsCard>
      ))}
      {confirmElement}
    </>
  );
}

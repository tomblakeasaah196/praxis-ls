/**
 * Company Profile, the editor's right-hand pane: one editor per fixed section
 * (guide §3.6).
 *
 * FACTS ONCE, WORDS PER LANGUAGE. A switch, a pick or a new item is a change
 * to `structure` and saves at once; a word is typed into the English or the
 * French box beside it and saves when the box is left. Both go through the one
 * `onSave` the page owns, which is also what keeps the completeness dot true.
 */
import * as React from "react";
import { companyProfile } from "@shared";
import { tr, currentLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/states";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useConfirm } from "@/components/ui/use-confirm";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";
import { ScanAttachment } from "@/components/scan-attachment";
import { dateFmt, num } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/company-profile-api";
import type { Editor, Item, Section, Structure, Words } from "@/lib/company-profile-api";

const { LIMITS } = companyProfile;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * A save. `structure` is a function of the section as last saved, run when the
 * save runs, so two quick ticks in a row both land; words are the keys changed.
 */
export type SavePatch = {
  structure?: (current: Structure) => Partial<Structure>;
  text_en?: Words;
  text_fr?: Words;
};
export type SaveFn = (patch: SavePatch) => Promise<void>;

/* ── the bilingual field ─────────────────────────────────────────────────── */

/**
 * English and French, side by side, saved when left. The pair shares one fact
 * (the key), so nothing about the item can differ between the two languages.
 */
function BiField({
  label,
  textKey,
  section,
  max,
  multiline = false,
  placeholderEn,
  placeholderFr,
  onSave,
}: {
  label: string;
  textKey: string;
  section: Section;
  max: number;
  multiline?: boolean;
  placeholderEn?: string | null;
  placeholderFr?: string | null;
  onSave: SaveFn;
}) {
  const storedEn = section.text_en[textKey] ?? "";
  const storedFr = section.text_fr[textKey] ?? "";
  const [en, setEn] = React.useState(storedEn);
  const [fr, setFr] = React.useState(storedFr);
  React.useEffect(() => setEn(storedEn), [storedEn]);
  React.useEffect(() => setFr(storedFr), [storedFr]);

  const commit = (lang: "EN" | "FR", value: string) => {
    const stored = lang === "EN" ? storedEn : storedFr;
    if (value.trim() === stored.trim()) return;
    const col = lang === "EN" ? "text_en" : "text_fr";
    void onSave({ [col]: { [textKey]: value } });
  };

  const Control = multiline ? Textarea : Input;
  const box = (lang: "EN" | "FR", value: string, set: (v: string) => void, placeholder?: string | null) => (
    <Field
      label={
        <>
          {tr(label)} <span className="micro text-muted-foreground">{lang}</span>
        </>
      }
    >
      <Control
        value={value}
        maxLength={max}
        rows={multiline ? 4 : undefined}
        placeholder={placeholder || undefined}
        onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => set(e.target.value)}
        onBlur={() => commit(lang, value)}
      />
    </Field>
  );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {box("EN", en, setEn, placeholderEn)}
      {box("FR", fr, setFr, placeholderFr)}
    </div>
  );
}

const change = (fn: (current: Structure) => Partial<Structure>): SavePatch => ({ structure: fn });

/** The next free item id: `c1`, `c2`, … */
function nextId(prefix: string, items: Item[]): string {
  const used = new Set(items.map((i) => i.id));
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/* ── sections ────────────────────────────────────────────────────────────── */

function CoverEditor({ section, coverUrl, onSave, onCover }: SectionProps & { onCover: (url: string | null) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const [error, setError] = React.useState<string | null>(null);
  // `photo`: the cover is a photograph, so a dull phone shot is levelled.
  const upload = useUpload<{ cover_url: string }>({
    profile: "photo",
    send: async (file, ctx) => api.uploadCover(await fileToDataUrl(file), ctx.onProgress),
    onAllComplete: ([out]) => {
      if (out) onCover(out.cover_url);
    },
  });
  const item = upload.items[0] ?? null;
  const busy = item?.state === "uploading" || item?.state === "compressing";
  React.useEffect(() => {
    if (item?.state === "error" && item.error) setError(item.error);
  }, [item?.state, item?.error]);

  async function remove() {
    const ok = await confirm({
      title: tr("Remove the cover image?"),
      body: tr("The draft prints without a photograph until another is uploaded. Published versions keep theirs."),
      confirmLabel: tr("Remove Image"),
      cancelLabel: tr("Keep It"),
    });
    if (!ok) return;
    try {
      await api.removeCover();
      upload.reset();
      onCover(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const shown = item?.previewUrl || coverUrl;
  return (
    <div className="space-y-5">
      <BiField label="Tagline" textKey="tagline" section={section} max={LIMITS.tagline} onSave={onSave} />
      <Field label={tr("Cover Image")} about={tr("A wide photograph printed on the first page and at the top of the shared page. PNG, JPEG or WebP, 10 MB at most.")}>
        <div className="space-y-2">
          {shown ? (
            <img src={shown} alt="" className="aspect-[3/1] w-full rounded-md border object-cover" />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <FilePicker
              variant="inline"
              accept={IMAGE_ACCEPT}
              disabled={busy}
              trigger={busy ? tr("Uploading…") : shown ? tr("Replace Image") : tr("Upload Image")}
              onPick={(files) => {
                setError(null);
                void upload.pick(files);
              }}
            />
            {coverUrl && !busy ? (
              <Button size="sm" variant="ghost" onClick={remove}>
                {tr("Remove Image")}
              </Button>
            ) : null}
          </div>
          {item && item.state !== "idle" ? (
            <UploadProgress state={item.state} percent={item.percent} error={item.error} />
          ) : null}
          {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}
        </div>
      </Field>
      {confirmDialog}
    </div>
  );
}

function WhoEditor({ section, onSave }: SectionProps) {
  const show = section.structure.show || {};
  const rows: { key: "positioning" | "history" | "mission"; label: string }[] = [
    { key: "positioning", label: "Positioning" },
    { key: "history", label: "Our Story" },
    { key: "mission", label: "Our Mission" },
  ];
  return (
    <div className="space-y-6">
      {rows.map((r) => (
        <div key={r.key} className="space-y-2">
          <Checkbox
            checked={show[r.key] !== false}
            label={tr(`Show ${r.label}`)}
            onCheckedChange={(on) => void onSave(change((cur) => ({ show: { ...(cur.show || {}), [r.key]: on } })))}
          />
          <BiField label={r.label} textKey={r.key} section={section} max={LIMITS.paragraph} multiline onSave={onSave} />
        </div>
      ))}
    </div>
  );
}

function ServicesEditor({ section, editor, onSave }: SectionProps) {
  const services = editor.choices.services;
  const items = section.structure.items || [];
  if (!services.length) {
    return <EmptyState title={tr("No published services yet")} hint={tr("Publish a service type on the website and it appears here.")} />;
  }
  const state = new Map(items.map((i) => [i.id, i.on !== false]));
  const ordered = [
    ...items.map((i) => services.find((s) => s.id === i.id)).filter(Boolean),
    ...services.filter((s) => !state.has(s.id)),
  ] as typeof services;
  const toggle = (id: string, on: boolean) =>
    void onSave(change((cur) => {
      const list = cur.items || [];
      const next = list.some((i) => i.id === id)
        ? list.map((i) => (i.id === id ? { ...i, on } : i))
        : [...list, { id, on }];
      return { items: next.filter((i) => services.some((s) => s.id === i.id)) };
    }));
  return (
    <ul className="space-y-4">
      {ordered.map((s) => {
        const on = state.get(s.id) === true;
        return (
          <li key={s.id} className="space-y-2 border-b pb-4 last:border-b-0">
            <Checkbox checked={on} label={s.name_en || s.name_fr || ""} onCheckedChange={(v) => toggle(s.id, v)} />
            {on ? (
              <BiField
                label="One Sentence"
                textKey={s.id}
                section={section}
                max={LIMITS.service_sentence}
                placeholderEn={s.short_en}
                placeholderFr={s.short_fr}
                onSave={onSave}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const FIGURES: { key: string; label: string }[] = [
  { key: "fleet_size", label: "Fleet Size" },
  { key: "fleet_mix", label: "Fleet Mix" },
  { key: "warehouse", label: "Warehouse Capacity" },
  { key: "offices", label: "Offices" },
  { key: "gateways", label: "Gateways" },
  { key: "regions", label: "Countries Served" },
];

/** A country code as its name in the screen's language; the code if the browser has no names. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([currentLocale()], { type: "region" }).of(code) || code;
  } catch {
    /* @silent:parse: a browser without region names shows the ISO code */
    return code;
  }
}

function figureValue(key: string, d: Editor["derived"]): string {
  if (!d) return "";
  switch (key) {
    case "fleet_size": return num(d.fleet_count || 0);
    case "fleet_mix": return Object.entries(d.fleet_composition || {}).map(([k, n]) => `${k} ${num(n)}`).join(", ");
    case "warehouse": return [Number(d.warehouse_capacity) ? num(d.warehouse_capacity) : "", d.warehouse_count ? `${num(d.warehouse_count)} ${tr("sites")}` : ""].filter(Boolean).join(" · ");
    case "offices": return num(d.offices || 0);
    case "gateways": return (d.gateways || []).join(", ");
    case "regions": return (d.regions || []).map(countryName).join(", ");
    default: return "";
  }
}

function CapacityEditor({ section, editor, onSave, onReload }: SectionProps) {
  const figures = section.structure.figures || {};
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await api.refreshFigures();
      await onReload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const d = editor.derived;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro text-muted-foreground">
          {tr("Figures As Of")} {d?.computed_at ? dateFmt(d.computed_at) : tr("Never")}
        </p>
        <Button size="sm" variant="outline" loading={busy} onClick={refresh}>
          {tr("Refresh Figures")}
        </Button>
      </div>
      {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {FIGURES.map((f) => {
          const value = figureValue(f.key, d);
          return (
            <li key={f.key} className="rounded-md border p-3">
              <Checkbox
                checked={figures[f.key] !== false}
                label={tr(f.label)}
                onCheckedChange={(on) => void onSave(change((cur) => ({ figures: { ...(cur.figures || {}), [f.key]: on } })))}
              />
              <p className="mt-1 truncate pl-7 text-sm text-muted-foreground">{value || tr("Nothing on record")}</p>
            </li>
          );
        })}
      </ul>
      <BiField label="Network Note" textKey="network" section={section} max={LIMITS.network} multiline onSave={onSave} />
    </div>
  );
}

function CertificationsEditor({ section, onSave }: SectionProps) {
  const items = section.structure.items || [];
  const [error, setError] = React.useState<string | null>(null);
  const update = (id: string, patch: Partial<Item>) =>
    void onSave(change((cur) => ({ items: (cur.items || []).map((i) => (i.id === id ? { ...i, ...patch } : i)) })));
  const add = () =>
    void onSave(change((cur) => {
      const list = cur.items || [];
      return { items: [...list, { id: nextId("c", list), kind: "CERTIFICATION", held: true, document_id: null }] };
    }));
  const remove = (id: string) => void onSave(change((cur) => ({ items: (cur.items || []).filter((i) => i.id !== id) })));
  return (
    <div className="space-y-4">
      {items.length === 0 ? <EmptyState title={tr("No certifications yet")} /> : null}
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label={tr("Kind")}
                value={item.kind || "CERTIFICATION"}
                options={[
                  { value: "CERTIFICATION", label: tr("Certification") },
                  { value: "MEMBERSHIP", label: tr("Membership") },
                ]}
                onChange={(kind) => update(item.id, { kind })}
              />
              <Checkbox checked={item.held === true} label={tr("Held")} onCheckedChange={(held) => update(item.id, { held })} />
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => remove(item.id)}>
                {tr("Remove")}
              </Button>
            </div>
            <BiField label="Name" textKey={item.id} section={section} max={LIMITS.certification_name} onSave={onSave} />
            <Field label={tr("Backing Document")} about={tr("Optional. The certificate itself, kept in the vault. It is not shown on the profile.")}>
              <ScanAttachment
                vaultId={item.document_id || null}
                docType="ENTITY_DOCUMENT"
                entityRef={`company_profile_certification:${item.id}`}
                labelWhenEmpty={tr("Attach Document")}
                onAttached={(id) => update(item.id, { document_id: id })}
                onError={setError}
              />
            </Field>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}
      <Button size="sm" variant="outline" disabled={items.length >= LIMITS.certifications} onClick={add}>
        {tr("Add Certification")}
      </Button>
    </div>
  );
}

function StoriesEditor({ section, editor, onSave }: SectionProps) {
  const picked = section.structure.story_ids || [];
  const stories = editor.choices.stories;
  if (!stories.length) {
    return <EmptyState title={tr("No published success stories yet")} hint={tr("Publish a story in Success Stories and it can be picked here.")} />;
  }
  const toggle = (id: string, on: boolean) =>
    void onSave(change((cur) => {
      const list = (cur.story_ids || []).filter((x) => x !== id);
      return { story_ids: on ? [...list, id] : list };
    }));
  return (
    <div className="space-y-3">
      <p className="micro text-muted-foreground">
        {picked.length} / {LIMITS.stories}
      </p>
      <ul className="space-y-2">
        {stories.map((s) => {
          const on = picked.includes(s.id);
          return (
            <li key={s.id} className="rounded-md border p-3">
              <Checkbox
                checked={on}
                disabled={!on && picked.length >= LIMITS.stories}
                label={s.title}
                onCheckedChange={(v) => toggle(s.id, v)}
              />
              <p className="mt-1 pl-7 text-xs text-muted-foreground">
                {s.client_name || tr("Client anonymised")}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClientsEditor({ section, editor, onSave, onReload }: SectionProps) {
  const [confirm, confirmDialog] = useConfirm();
  const on = section.structure.logo_ids || [];
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const nameRef = React.useRef("");
  nameRef.current = name;
  // `brand`: a client's mark comes back in exactly its own colours.
  const upload = useUpload<api.Logo>({
    profile: "brand",
    autoStart: false,
    send: async (file, ctx) => api.addLogo(nameRef.current.trim(), await fileToDataUrl(file), ctx.onProgress),
    onAllComplete: () => {
      setName("");
      upload.reset();
      void onReload();
    },
  });
  const item = upload.items[0] ?? null;
  const busy = item?.state === "uploading" || item?.state === "compressing";
  React.useEffect(() => {
    if (item?.state === "error" && item.error) setError(item.error);
  }, [item?.state, item?.error]);

  async function retire(logo: api.Logo) {
    const ok = await confirm({
      title: tr("Retire this logo?"),
      body: tr("It leaves the library and the draft. Published versions that show it keep it."),
      confirmLabel: tr("Retire Logo"),
      cancelLabel: tr("Keep It"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.retireLogo(logo.id);
      await onReload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const active = editor.choices.logos.filter((l) => !l.retired);
  const toggle = (id: string, v: boolean) =>
    void onSave(change((cur) => {
      const list = (cur.logo_ids || []).filter((x) => x !== id);
      return { logo_ids: v ? [...list, id] : list };
    }));

  return (
    <div className="space-y-5">
      {active.length === 0 ? <EmptyState title={tr("No client logos yet")} /> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((l) => (
          <li key={l.id} className="space-y-2 rounded-md border p-3">
            <div className="flex h-14 items-center justify-center rounded bg-background">
              {l.url ? <img src={l.url} alt={l.name} className="max-h-12 max-w-full object-contain" /> : null}
            </div>
            <Checkbox checked={on.includes(l.id)} label={tr("On Profile")} onCheckedChange={(v) => toggle(l.id, v)} />
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm">{l.name}</p>
              <Button size="sm" variant="ghost" onClick={() => retire(l)}>
                {tr("Retire")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-3 rounded-md border p-3">
        <Field label={tr("Client Name")}>
          <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        </Field>
        <FilePicker
          variant="inline"
          accept={IMAGE_ACCEPT}
          disabled={busy}
          trigger={item ? tr("Choose Another") : tr("Choose Logo")}
          onPick={(files) => {
            setError(null);
            upload.reset();
            void upload.pick(files);
          }}
        />
        {item ? (
          <div className="flex items-center gap-3">
            {item.previewUrl ? <img src={item.previewUrl} alt="" className="h-10 w-auto rounded border bg-background object-contain p-1" /> : null}
            <div className="min-w-0 flex-1">
              <UploadProgress state={item.state} percent={item.percent} error={item.error} />
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}
        <Button size="sm" disabled={!item || !name.trim() || busy} loading={busy} onClick={() => upload.start()}>
          {tr("Add Logo")}
        </Button>
      </div>
      {confirmDialog}
    </div>
  );
}

function WhyEditor({ section, onSave }: SectionProps) {
  const items = section.structure.items || [];
  const set = (fn: (list: Item[]) => Item[]) => void onSave(change((cur) => ({ items: fn(cur.items || []) })));
  return (
    <div className="space-y-4">
      {items.length === 0 ? <EmptyState title={tr("No promises yet")} /> : null}
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={item.on !== false}
                label={tr("On Profile")}
                onCheckedChange={(v) => set((list) => list.map((i) => (i.id === item.id ? { ...i, on: v } : i)))}
              />
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set((list) => list.filter((i) => i.id !== item.id))}>
                {tr("Remove")}
              </Button>
            </div>
            <BiField label="Promise" textKey={`${item.id}.title`} section={section} max={LIMITS.promise_title} onSave={onSave} />
            <BiField label="Detail" textKey={`${item.id}.body`} section={section} max={LIMITS.promise_body} multiline onSave={onSave} />
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        disabled={items.length >= LIMITS.promises}
        onClick={() => set((list) => [...list, { id: nextId("w", list), on: true }])}
      >
        {tr("Add Promise")}
      </Button>
    </div>
  );
}

function ContactEditor({ section, editor, onSave }: SectionProps) {
  const show = section.structure.show || {};
  const facts = editor.contact || {};
  const rows: { key: "address" | "phone" | "email" | "website"; label: string }[] = [
    { key: "address", label: "Address" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "website", label: "Website" },
  ];
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="rounded-md border p-3">
          <Checkbox
            checked={show[r.key] !== false}
            label={tr(r.label)}
            onCheckedChange={(v) => void onSave(change((cur) => ({ show: { ...(cur.show || {}), [r.key]: v } })))}
          />
          <p className="mt-1 pl-7 text-sm text-muted-foreground">{facts[r.key] || tr("Not on the corporate entity")}</p>
        </li>
      ))}
    </ul>
  );
}

/* ── dispatch ─────────────────────────────────────────────────────────────── */

type SectionProps = {
  section: Section;
  editor: Editor;
  coverUrl: string | null;
  onSave: SaveFn;
  onReload: () => Promise<void>;
};

export function SectionEditor(props: SectionProps & { onCover: (url: string | null) => void }) {
  switch (props.section.key) {
    case "cover": return <CoverEditor {...props} />;
    case "who_we_are": return <WhoEditor {...props} />;
    case "services": return <ServicesEditor {...props} />;
    case "capacity": return <CapacityEditor {...props} />;
    case "certifications": return <CertificationsEditor {...props} />;
    case "case_stories": return <StoriesEditor {...props} />;
    case "clients": return <ClientsEditor {...props} />;
    case "why_us": return <WhyEditor {...props} />;
    case "contact": return <ContactEditor {...props} />;
    default: return null;
  }
}

/**
 * The About page's sections (14660, doc/smartls-website/ENGINEERING_GUIDE.md
 * PR 4): the credentials row, the story, the principles' heading, the leader's
 * message, the offices, the sectors, the standards and the closing band, in the
 * order the page draws them.
 *
 * ── ONE LANGUAGE UNLESS THE SITE OFFERS TWO ───────────────────────────────
 *
 * An English-only site shows the English inputs alone. When the tenant offers
 * French (Settings › Website › Options) each line gains its French twin. The
 * API refuses a line missing the site's required language, so the screen never
 * has to guess which half matters.
 *
 * ── EVERY SECTION IS OPTIONAL ─────────────────────────────────────────────
 *
 * A section with nothing in it is not drawn on the page. That is the empty
 * state, and it is why nothing here is marked required.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsCard, Field } from "@/components/settings/controls";
import { tr } from "@/lib/i18n";
import { loadSiteMeta } from "@/lib/site-content-api";
import type * as api from "@/lib/site-settings-api";

type Sections = api.AboutSections;
type Bi = api.BiText;

/** Does the website offer French? Read once from the site's own meta. */
function useOffersFrench(): boolean {
  const [fr, setFr] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void loadSiteMeta().then((meta) => {
      if (alive && meta) setFr((meta.languages ?? ["en"]).includes("fr"));
    });
    return () => {
      alive = false;
    };
  }, []);
  return fr;
}

const LangContext = React.createContext(false);

/** One bilingual line or paragraph. English always; French when offered. */
function BiField({
  label,
  about,
  value,
  rows = 0,
  max,
  onChange,
}: {
  label: string;
  about?: string;
  value: Bi | undefined;
  rows?: number;
  max: number;
  onChange: (v: Bi) => void;
}) {
  const french = React.useContext(LangContext);
  const v = value || {};
  const set = (lang: "en" | "fr", text: string) => onChange({ ...v, [lang]: text });
  const control = (lang: "en" | "fr") =>
    rows ? (
      <Textarea rows={rows} maxLength={max} value={v[lang] ?? ""} onChange={(e) => set(lang, e.target.value)} />
    ) : (
      <Input maxLength={max} value={v[lang] ?? ""} onChange={(e) => set(lang, e.target.value)} />
    );
  if (!french) {
    return (
      <Field label={label} about={about}>
        {control("en")}
      </Field>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`${label} (EN)`} about={about}>
        {control("en")}
      </Field>
      <Field label={`${label} (FR)`}>{control("fr")}</Field>
    </div>
  );
}

/** A list of rows with Add and Remove, capped at what the schema accepts. */
function Rows<T>({
  items,
  max,
  addLabel,
  blank,
  onChange,
  render,
}: {
  items: T[];
  max: number;
  addLabel: string;
  blank: () => T;
  onChange: (next: T[]) => void;
  render: (item: T, set: (next: T) => void, index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-[var(--border)] p-3">
          {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))), i)}
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              {tr("Remove")}
            </Button>
          </div>
        </div>
      ))}
      {items.length < max ? (
        <Button size="sm" variant="outline" onClick={() => onChange([...items, blank()])}>
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function AboutSectionsEditor({
  sections,
  leaders,
  entities,
  onChange,
}: {
  sections: Sections;
  leaders: api.Leader[];
  entities: { entity_id: string; legal_name: string; trading_name?: string | null }[];
  onChange: (next: Sections) => void;
}) {
  const french = useOffersFrench();
  const s = sections || {};
  const put = <K extends keyof Sections>(k: K, v: Sections[K]) => onChange({ ...s, [k]: v });

  return (
    <LangContext.Provider value={french}>
      <SettingsCard title={tr("Hero and Credentials")}>
        <div className="space-y-4">
          <BiField
            label={tr("Eyebrow")}
            about={tr("The one or two words above the headline, such as About Us.")}
            value={s.hero_eyebrow}
            max={60}
            onChange={(v) => put("hero_eyebrow", v)}
          />
          <Field
            label={tr("Credentials Row")}
            about={tr("Up to six facts a visitor can check, each a label over a value: Established, 2021, Douala. No counters: a number nobody can verify reads as a claim.")}
          >
            <Rows
              items={s.credentials ?? []}
              max={6}
              addLabel={tr("Add Fact")}
              blank={() => ({ label: { en: "" }, value: { en: "" } })}
              onChange={(v) => put("credentials", v)}
              render={(item, set) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <BiField label={tr("Label")} value={item.label} max={60} onChange={(label) => set({ ...item, label })} />
                  <BiField label={tr("Value")} value={item.value} max={120} onChange={(value) => set({ ...item, value })} />
                </div>
              )}
            />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title={tr("Our Story")}>
        <div className="space-y-4">
          <BiField label={tr("Section Title")} value={s.story?.title} max={120} onChange={(title) => put("story", { ...s.story, title })} />
          <Rows
            items={s.story?.paragraphs ?? []}
            max={8}
            addLabel={tr("Add Paragraph")}
            blank={() => ({ en: "" })}
            onChange={(paragraphs) => put("story", { ...s.story, paragraphs })}
            render={(p, set, i) => (
              <BiField label={`${tr("Paragraph")} ${i + 1}`} value={p} rows={4} max={1600} onChange={set} />
            )}
          />
          <BiField
            label={tr("How We Work: Section Title")}
            about={tr("The heading over your principles, which are edited under Positioning.")}
            value={s.principles_title}
            max={120}
            onChange={(v) => put("principles_title", v)}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={tr("The Leader's Message")}>
        <div className="space-y-4">
          <Field
            label={tr("Signed By")}
            about={tr("The person whose portrait and name sign the message. Add the person under Leadership first; a portrait must be a real photograph.")}
          >
            <select
              className="h-9 w-full max-w-md rounded-md border border-input bg-card px-2 text-sm"
              value={s.message?.leader_id ?? ""}
              onChange={(e) => put("message", { ...s.message, leader_id: e.target.value || null })}
            >
              <option value="">{tr("No message")}</option>
              {leaders.map((l) => (
                <option key={l.leader_id} value={l.leader_id}>
                  {l.full_name}
                </option>
              ))}
            </select>
          </Field>
          <BiField label={tr("Section Title")} value={s.message?.title} max={120} onChange={(title) => put("message", { ...s.message, title })} />
          <Rows
            items={s.message?.paragraphs ?? []}
            max={10}
            addLabel={tr("Add Paragraph")}
            blank={() => ({ en: "" })}
            onChange={(paragraphs) => put("message", { ...s.message, paragraphs })}
            render={(p, set, i) => (
              <BiField label={`${tr("Paragraph")} ${i + 1}`} value={p} rows={4} max={1600} onChange={set} />
            )}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={tr("Offices")}>
        <div className="space-y-4">
          <BiField label={tr("Section Title")} value={s.offices?.title} max={120} onChange={(title) => put("offices", { ...s.offices, title })} />
          <Rows
            items={s.offices?.items ?? []}
            max={3}
            addLabel={tr("Add Office")}
            blank={() => ({ entity_id: entities[0]?.entity_id ?? "", heading: { en: "" }, label: { en: "" }, services: { en: "" } })}
            onChange={(items) => put("offices", { ...s.offices, items })}
            render={(item, set) => (
              <div className="space-y-3">
                <Field
                  label={tr("Company")}
                  about={tr("The address, phone and email are read from the company in Master Data, so they are corrected in one place.")}
                >
                  <select
                    className="h-9 w-full max-w-md rounded-md border border-input bg-card px-2 text-sm"
                    value={item.entity_id}
                    onChange={(e) => set({ ...item, entity_id: e.target.value })}
                  >
                    {entities.map((e) => (
                      <option key={e.entity_id} value={e.entity_id}>
                        {e.trading_name || e.legal_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <BiField label={tr("Heading")} about={tr("The city and country, such as Douala, Cameroon.")} value={item.heading} max={80} onChange={(heading) => set({ ...item, heading })} />
                  <BiField label={tr("Label")} about={tr("Head Office, European Office.")} value={item.label} max={60} onChange={(label) => set({ ...item, label })} />
                </div>
                <BiField label={tr("What This Office Does")} value={item.services} rows={2} max={400} onChange={(services) => set({ ...item, services })} />
              </div>
            )}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={tr("Who We Move For")}>
        <div className="space-y-4">
          <BiField label={tr("Section Title")} value={s.sectors?.title} max={120} onChange={(title) => put("sectors", { ...s.sectors, title })} />
          <Rows
            items={s.sectors?.items ?? []}
            max={8}
            addLabel={tr("Add Sector")}
            blank={() => ({ title: { en: "" }, text: { en: "" } })}
            onChange={(items) => put("sectors", { ...s.sectors, items })}
            render={(item, set) => (
              <div className="space-y-3">
                <BiField label={tr("Sector")} value={item.title} max={120} onChange={(title) => set({ ...item, title })} />
                <BiField label={tr("One Line")} value={item.text} rows={2} max={400} onChange={(text) => set({ ...item, text })} />
              </div>
            )}
          />
          <BiField
            label={tr("Caption Over the Client Logos")}
            about={tr("The logos are your active clients under Partners.")}
            value={s.sectors?.clients_caption}
            max={160}
            onChange={(clients_caption) => put("sectors", { ...s.sectors, clients_caption })}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={tr("Standards and Closing")}>
        <div className="space-y-4">
          <BiField label={tr("Standards: Section Title")} value={s.standards?.title} max={120} onChange={(title) => put("standards", { ...s.standards, title })} />
          <BiField
            label={tr("Standards: Text")}
            about={tr("How the company is governed. The published trust documents and the memberships are listed beneath it automatically.")}
            value={s.standards?.text}
            rows={3}
            max={1600}
            onChange={(text) => put("standards", { ...s.standards, text })}
          />
          <BiField label={tr("Closing Band: Title")} value={s.closing?.title} max={120} onChange={(title) => put("closing", { ...s.closing, title })} />
          <BiField label={tr("Closing Band: Line")} value={s.closing?.text} rows={2} max={400} onChange={(text) => put("closing", { ...s.closing, text })} />
        </div>
      </SettingsCard>

    </LangContext.Provider>
  );
}

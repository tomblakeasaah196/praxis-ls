/**
 * Settings › Website › AI Profile: what AI assistants read about the company
 * (14700).
 *
 * The same row feeds `/llms.txt`, `/llms-full.txt` and the Organization
 * structured data every public page carries. It is plain English written for a
 * machine that will repeat it, so the screen is plain text fields and nothing
 * else: no rich text, no bilingual halves.
 *
 * ── THE SUMMARY DECIDES WHETHER ANYTHING IS PUBLISHED ─────────────────────
 *
 * A profile with no summary publishes nothing at all (`site_ai_profile.js`,
 * `published()`), so a tenant who has not written one gets a 404 at /llms.txt
 * rather than a file of defaults describing somebody else. The pill on the
 * Summary card reads the SAVED row, not the form, because "published" is a fact
 * about the server and a half-typed sentence has not been published yet.
 *
 * ── ONLY WHAT CHANGED IS SENT ─────────────────────────────────────────────
 *
 * The PUT is partial on purpose. The AI manifest writes this row too
 * (`update_site_ai_profile`), and a form that sent all twelve fields would
 * quietly put back whatever the assistant had changed since this screen loaded.
 * So save diffs the form against the row it loaded and sends the difference,
 * parsed through the same shared schema the API validates with.
 *
 * ── LISTS ARE ONE PER LINE ────────────────────────────────────────────────
 *
 * Other names, sectors and areas served are short strings. A textarea with one
 * per line is the list editor the rest of the app already uses (HR onboarding,
 * SOPs), and it pastes from a document without a click per item.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { useCan } from "@/lib/route-access";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import { siteSettings } from "@praxis/shared";
import * as api from "@/lib/site-settings-api";
import { WebsiteNav } from "./website-nav";

type TextKey =
  | "summary"
  | "founded"
  | "offices"
  | "services_summary"
  | "credentials"
  | "leadership"
  | "not_offered"
  | "contact"
  | "reviewed_on";
type ListKey = "alternate_names" | "sectors" | "areas_served";
type Key = TextKey | ListKey;

const TEXT_KEYS: TextKey[] = [
  "summary",
  "founded",
  "offices",
  "services_summary",
  "credentials",
  "leadership",
  "not_offered",
  "contact",
  "reviewed_on",
];
const LIST_KEYS: ListKey[] = ["alternate_names", "sectors", "areas_served"];

/** The form holds every field as the string its control edits: a list is its
 *  lines joined, a date is its ISO day or "". */
type Form = Record<Key, string>;

/** The label each field carries, also used to name a field in a refusal. */
const LABEL: Record<Key, () => string> = {
  summary: () => tr("Summary"),
  alternate_names: () => tr("Other Names"),
  founded: () => tr("Founded"),
  offices: () => tr("Offices"),
  services_summary: () => tr("Services"),
  sectors: () => tr("Sectors"),
  areas_served: () => tr("Areas Served"),
  credentials: () => tr("Memberships and Credentials"),
  leadership: () => tr("Leadership"),
  not_offered: () => tr("What the Company Does Not Do"),
  contact: () => tr("Contact"),
  reviewed_on: () => tr("Last Reviewed"),
};

/** Max lengths, the same numbers `siteSettings.aiProfile` enforces. */
const PROSE_MAX = 4000;

function toForm(row: api.SiteAiProfile | null): Form {
  const out = {} as Form;
  for (const k of TEXT_KEYS) out[k] = (row?.[k] as string | null) ?? "";
  for (const k of LIST_KEYS) out[k] = (row?.[k] ?? []).join("\n");
  return out;
}

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** A field's value as the API would store it, so "changed" means changed on
 *  the server and not merely retyped with a trailing space. */
function normal(k: Key, v: string): string | null | string[] {
  if ((LIST_KEYS as Key[]).includes(k)) return lines(v);
  return v.trim() || null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function WebsiteAiProfilePage() {
  const can = useCan("MOD-29");
  const editable = can("edit") !== false;
  const [loaded, setLoaded] = React.useState<Form | null>(null);
  const [form, setForm] = React.useState<Form>(() => toForm(null));
  const [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    setSaveError(null);
    setSaved(false);
    try {
      // 14700 seeds the singleton; a null row is a database restored without
      // it, and an empty form is the honest reading of that.
      const next = toForm(await api.getAiProfile());
      setLoaded(next);
      setForm(next);
    } catch (e) {
      setLoadError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const changed = React.useMemo(() => {
    if (!loaded) return [] as Key[];
    return ([...TEXT_KEYS, ...LIST_KEYS] as Key[]).filter(
      (k) => !same(normal(k, form[k]), normal(k, loaded[k])),
    );
  }, [form, loaded]);

  const published = Boolean(loaded?.summary.trim());

  async function save() {
    if (!changed.length) return;
    setSaveError(null);
    setSaved(false);
    const body: Record<string, unknown> = {};
    for (const k of changed) body[k] = normal(k, form[k]);
    // Through the shared schema first, so a body the API would refuse is
    // refused here, naming the field it is about. Every field in it is
    // optional, so it validates a partial body as it stands.
    const parsed = siteSettings.aiProfile.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const key = issue?.path[0] as Key | undefined;
      setSaveError(
        key && LABEL[key] ? `${LABEL[key]()}: ${issue.message}` : errMsg(parsed.error),
      );
      return;
    }
    setBusy(true);
    try {
      const row = await api.saveAiProfile(parsed.data as Partial<api.SiteAiProfile>);
      const next = toForm(row);
      setLoaded(next);
      setForm(next);
      setSaved(true);
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: Key, v: string) => {
    setSaved(false);
    setForm((s) => ({ ...s, [k]: v }));
  };

  const off = busy || !editable;

  /** A text field: one line for short values, a textarea for prose. */
  const text = (k: Key, max: number, rows = 0, placeholder?: string) =>
    rows ? (
      <Textarea
        value={form[k]}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        disabled={off}
        onChange={(e) => set(k, e.target.value)}
      />
    ) : (
      <Input
        value={form[k]}
        maxLength={max}
        placeholder={placeholder}
        disabled={off}
        onChange={(e) => set(k, e.target.value)}
      />
    );

  if (loadError) {
    return (
      <>
        <PageHeader
          eyebrow={<HubCrumb area="Settings" to="/settings" />}
          title={tr("AI Profile")}
        />
        <WebsiteNav />
        <ErrorState
          message={loadError}
          action={<Button onClick={() => void load()}>{tr("Try again")}</Button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("AI Profile")}
        description={tr(
          "What ChatGPT, Gemini, Claude and other AI assistants read about the company. Published at /llms.txt and in the website's search data. Write plain facts in English. Leave it empty and nothing is published.",
        )}
      />
      <WebsiteNav />

      {saveError && (
        <Callout tone="bad" title={tr("Not saved")} className="mb-4">
          {saveError}
        </Callout>
      )}
      {saved && !saveError && (
        <Callout tone="ok" className="mb-4">
          {tr("Saved. AI assistants read it on their next visit.")}
        </Callout>
      )}

      {loaded && (
        <div className="flex flex-col gap-5">
          <SettingsCard
            title={tr("Summary")}
            action={
              <Pill tone={published ? "ok" : "mute"}>
                <span>{published ? tr("Published") : tr("Not Published")}</span>
              </Pill>
            }
          >
            <Field
              label={LABEL.summary()}
              about={tr("An empty summary publishes nothing.")}
            >
              {text("summary", 1200, 5)}
            </Field>
          </SettingsCard>

          <SettingsCard title={tr("The Company")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={LABEL.alternate_names()}>
                {text("alternate_names", 12 * 121, 3, tr("One per line"))}
              </Field>
              <Field label={LABEL.founded()}>{text("founded", 40)}</Field>
            </div>
            <div className="mt-4 grid gap-4">
              <Field label={LABEL.offices()}>{text("offices", PROSE_MAX, 3)}</Field>
              <Field label={LABEL.leadership()}>
                {text("leadership", PROSE_MAX, 3)}
              </Field>
              <Field label={LABEL.credentials()}>
                {text("credentials", PROSE_MAX, 3)}
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard title={tr("What the Company Does")}>
            <div className="grid gap-4">
              <Field label={LABEL.services_summary()}>
                {text("services_summary", PROSE_MAX, 4)}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={LABEL.sectors()}>
                  {text("sectors", 30 * 121, 4, tr("One per line"))}
                </Field>
                <Field label={LABEL.areas_served()}>
                  {text("areas_served", 40 * 121, 4, tr("One per line"))}
                </Field>
              </div>
              <Field label={LABEL.not_offered()}>
                {text("not_offered", PROSE_MAX, 3)}
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard title={tr("Contact and Review")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={LABEL.contact()}>{text("contact", 800, 3)}</Field>
              <Field label={LABEL.reviewed_on()}>
                <DateField
                  value={form.reviewed_on}
                  disabled={off}
                  onChange={(iso) => set("reviewed_on", iso)}
                />
              </Field>
            </div>
          </SettingsCard>
        </div>
      )}

      {editable && loaded ? (
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={busy || !changed.length}
          >
            {tr("Discard Changes")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !changed.length}>
            {busy ? tr("Saving…") : tr("Save Profile")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

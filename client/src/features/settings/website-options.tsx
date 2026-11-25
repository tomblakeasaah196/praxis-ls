/**
 * Settings › Website › Options — what the shared website build shows for this
 * tenant (14600, website v2).
 *
 * ── WHY EVERY SWITCH STARTS OFF ───────────────────────────────────────────
 *
 * One public-web build serves every tenant, so a section removed in code is
 * removed for all of them. The first tenant's review (24 Nov 2026) asked for a
 * top rail, a portfolio, two map scenes, a case-notes band and the French
 * version to go; the owner's answer was switches, default off. A section a
 * tenant has not asked for is a section nobody there has checked, and turning
 * one on is a decision with a person behind it, which is what this screen is.
 *
 * ── LANGUAGES ARE NOT A COSMETIC SWITCH ───────────────────────────────────
 *
 * French offered changes which half of every bilingual field is REQUIRED
 * (`siteLanguages.requiredLanguage`): English on an English-only site, French
 * where French is offered. Turning French off never deletes a French sentence;
 * the site simply stops serving them. So the choice is a `Select` with both
 * outcomes named rather than a toggle, and the consequence is printed on the
 * card rather than hidden behind the ⓘ.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, Select } from "@/components/ui/modal";
import { SettingsCard, Toggle } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { useCan } from "@/lib/route-access";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import { siteSettings } from "@praxis/shared";
import * as api from "@/lib/site-settings-api";
import { WebsiteNav } from "./website-nav";

const DEFAULTS: api.SiteSwitches = {
  languages: ["en"],
  top_rail: false,
  portfolio: false,
  corridors: false,
  case_notes: false,
  careers_in_header: false,
  visitor_theme_switch: false,
};

type SwitchKey = keyof Omit<api.SiteSwitches, "languages">;

/** The label and the one short line under it, per switch. The line names what
 *  appears on the site, never how the switch works. */
const SWITCHES: Record<SwitchKey, { label: () => string; hint: () => string }> = {
  top_rail: {
    label: () => tr("Top Rail"),
    hint: () => tr("A thin strip above the header with tracking and language."),
  },
  careers_in_header: {
    label: () => tr("Careers In The Header"),
    hint: () => tr("The footer link to Careers stays either way."),
  },
  portfolio: {
    label: () => tr("Portfolio Pages"),
    hint: () => tr("The case notes pages and their menu item."),
  },
  case_notes: {
    label: () => tr("Case Notes Band"),
    hint: () => tr("Three case notes on the homepage."),
  },
  corridors: {
    label: () => tr("Corridors And Network"),
    hint: () => tr("The map scenes on the homepage and the About page."),
  },
  visitor_theme_switch: {
    label: () => tr("Visitor Dark Mode Switch"),
    hint: () => tr("Lets a visitor turn the site dark. Light stays the default."),
  },
};

const GROUPS: { title: () => string; keys: SwitchKey[] }[] = [
  { title: () => tr("Header"), keys: ["top_rail", "careers_in_header"] },
  { title: () => tr("Sections"), keys: ["portfolio", "case_notes", "corridors"] },
  { title: () => tr("Appearance"), keys: ["visitor_theme_switch"] },
];

export function WebsiteOptionsPage() {
  const can = useCan("MOD-29");
  const [form, setForm] = React.useState<api.SiteSwitches>(DEFAULTS);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const row = await api.getSwitches();
      setForm({ ...DEFAULTS, ...(row || {}) });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const french = form.languages.includes("fr");

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Through the shared schema first, so a body the API would refuse is
      // refused here with the same answer.
      const body = siteSettings.siteSwitches.parse(form) as api.SiteSwitches;
      setForm({ ...DEFAULTS, ...(await api.saveSwitches(body)) });
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof api.SiteSwitches>(k: K, v: api.SiteSwitches[K]) => {
    setSaved(false);
    setForm((s) => ({ ...s, [k]: v }));
  };

  const editable = can("edit") !== false;

  return (
    <>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Website Options")}
        description={tr(
          "The languages your website offers and the optional sections it shows. Every option starts off.",
        )}
      />
      <WebsiteNav />

      {error && <ErrorState message={error} />}
      {saved && (
        <Callout tone="ok" className="mb-4">
          {tr("Saved. Your website picks this up within five minutes.")}
        </Callout>
      )}

      <SettingsCard
        title={tr("Languages")}
        desc={tr(
          "English is always offered. French adds a language switch to every page.",
        )}
        notice={
          french
            ? tr("French is offered, so French is required on every bilingual field.")
            : tr("English only: English is required on every field and French is never shown.")
        }
      >
        <Field label={tr("Languages Offered")}>
          <Select
            value={french ? "en,fr" : "en"}
            disabled={busy || !editable}
            onChange={(e) =>
              set("languages", e.target.value === "en,fr" ? ["en", "fr"] : ["en"])
            }
          >
            <option value="en">{tr("English only")}</option>
            <option value="en,fr">{tr("English and French")}</option>
          </Select>
        </Field>
      </SettingsCard>

      {GROUPS.map((group) => (
        <SettingsCard key={group.title()} title={group.title()} className="mt-5">
          <div className="flex flex-col gap-3">
            {group.keys.map((k) => (
              <Toggle
                key={k}
                checked={form[k]}
                onChange={(v) => editable && set(k, v)}
                label={SWITCHES[k].label()}
                hint={SWITCHES[k].hint()}
              />
            ))}
          </div>
        </SettingsCard>
      ))}

      <div className="mt-5 flex items-center gap-2">
        <Button variant="outline" onClick={() => void load()} disabled={busy}>
          {tr("Reset")}
        </Button>
        {editable ? (
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? tr("Saving…") : tr("Save Options")}
          </Button>
        ) : null}
      </div>
    </>
  );
}

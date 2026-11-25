/**
 * Which language a website form must have filled in (website v2).
 *
 * English on an English-only site, French where the tenant offers French: the
 * rule is `siteLanguages.requiredLanguage` from @praxis/shared, the same one
 * the API refuses a save with, so a form never marks one half required while
 * the server insists on the other.
 *
 * The answer comes from the website editor's own bootstrap read (`/site/meta`,
 * cached once per session by `loadSiteMeta`). Until it lands, and for anybody
 * who cannot read it, the answer is English, which is what every tenant ships
 * with (14600).
 */
import * as React from "react";
import { siteLanguages } from "@praxis/shared";
import { tr } from "./i18n";
import { loadSiteMeta } from "./site-content-api";

export type SiteLang = "en" | "fr";

export function useRequiredSiteLanguage(): SiteLang {
  const [lang, setLang] = React.useState<SiteLang>("en");
  React.useEffect(() => {
    let alive = true;
    void loadSiteMeta().then((meta) => {
      if (!alive || !meta) return;
      setLang(
        meta.required_language ??
          siteLanguages.requiredLanguage(meta.languages ?? ["en"]),
      );
    });
    return () => {
      alive = false;
    };
  }, []);
  return lang;
}

/** "English" or "French", for a label. */
export const languageName = (lang: SiteLang): string =>
  lang === "fr" ? tr("French") : tr("English");

/** The message a form shows beside a required half left blank. */
export const requiredMessage = (lang: SiteLang): string =>
  lang === "fr" ? tr("French is required.") : tr("English is required.");

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { getLegalEntities, type LegalEntity } from "@/lib/brand-api";
import "@/components/site/brand.css";
import "./legal-i18n";
import { legalNameWithForm, phoneDisplay, phoneHref } from "@/lib/brand-api";

/** The name carries the form as written ("... UG (haftungsbeschränkt)"),
 *  not just an equivalent of it ("LTD" for a SARL). */
const nameSpellsForm = (name: string, form: string) =>
  name.toUpperCase().replace(/\./g, "").includes(form.toUpperCase().replace(/\./g, ""));

/**
 * `/legal/impressum` (PR 4, item 8): who operates this website, in English and
 * German, written from the companies the tenant publishes (Master Data): legal
 * name and form, registered office, who represents it, the commercial register
 * and its court, the VAT number, and how to reach it.
 *
 * ── NOTHING ON THIS PAGE IS TYPED HERE ────────────────────────────────────
 *
 * Every fact is the company's own record, so correcting the register number
 * on the company corrects the Impressum. A fact not yet recorded is left out
 * rather than printed as an empty label; a company with no register yet says
 * the details are being added, which is true and better than a blank.
 *
 * ── GERMAN BECAUSE THE LAW IS GERMAN ──────────────────────────────────────
 *
 * § 5 DDG is a German obligation, so this page, and the privacy policy, are
 * the only pages with a German version (owner decision 19). The labels are the
 * dictionary's `site.legal.de` strings, German in both language trees.
 */
type Lang = "en" | "de";

export function ImpressumPage() {
  const { t } = useTranslation();
  const [lang, setLang] = React.useState<Lang>("en");
  const [rows, setRows] = React.useState<LegalEntity[] | null>(null);
  const L = (key: string) => t(lang === "de" ? `site.legal.de.${key}` : `site.legal.${key}`);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    getLegalEntities(controller.signal).then((r) => alive && setRows(r));
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  useDocumentMeta({ title: t("site.legal.impressum"), description: t("site.legal.impressumLead") });

  return (
    <PageShell label={t("site.legal.impressum")} footer>
      <section className="band doc-page">
        <PageContainer size="reading">
          <header className="doc-head" lang={lang}>
            <h1 className="font-display text-h2 font-semibold sm:text-h1">{L("impressum")}</h1>
            <p className="mt-3 text-lg text-muted-foreground">
              {lang === "de" ? t("site.legal.de.lead") : t("site.legal.impressumLead")}
            </p>
            <div className="lang-switch mt-6" role="group" aria-label="Language / Sprache">
              <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                English
              </button>
              <button type="button" lang="de" aria-pressed={lang === "de"} onClick={() => setLang("de")}>
                Deutsch
              </button>
            </div>
          </header>

          <div className="mt-10" lang={lang}>
            {(rows || []).map((e) => (
              <article key={e.id} className="legal-entity">
                <h2 className="font-display text-h3 font-semibold">
                  {legalNameWithForm(e.legal_name, e.legal_form)}
                </h2>
                {/* The form on its own line when the name does not spell it:
                    "SMART LOGISTICS AND SERVICES LTD" is a Cameroonian SARL,
                    and § 5 DDG wants the form stated, not translated. */}
                {e.legal_form && !nameSpellsForm(e.legal_name, e.legal_form) ? (
                  <p className="text-muted-foreground">{e.legal_form}</p>
                ) : null}
                <dl className="legal-facts">
                  {e.address_lines.length ? (
                    <>
                      <dt>{L("registeredOffice")}</dt>
                      <dd>
                        {e.address_lines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </dd>
                    </>
                  ) : null}
                  {e.representatives.length ? (
                    <>
                      <dt>{L("representedBy")}</dt>
                      <dd>
                        {e.representatives.map((r) => (
                          <span key={r.name}>{r.title ? `${r.name}, ${r.title}` : r.name}</span>
                        ))}
                      </dd>
                    </>
                  ) : null}
                  {e.register ? (
                    <>
                      <dt>{L("register")}</dt>
                      <dd>
                        <span>{e.register.number}</span>
                        {e.register.authority ? (
                          <span className="text-muted-foreground">
                            {L("registerCourt")}: {e.register.authority}
                          </span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                  {e.vat_id ? (
                    <>
                      <dt>{L("vatId")}</dt>
                      <dd>{e.vat_id}</dd>
                    </>
                  ) : null}
                  {e.phone || e.email || e.website ? (
                    <>
                      <dt>{L("contact")}</dt>
                      <dd>
                        {e.phone ? (
                          <span>
                            {L("phone")}: <a href={phoneHref(e.phone)}>{phoneDisplay(e.phone)}</a>
                          </span>
                        ) : null}
                        {e.email ? (
                          <span>
                            {L("email")}: <a href={`mailto:${e.email}`}>{e.email}</a>
                          </span>
                        ) : null}
                        {e.website ? (
                          <span>
                            {L("website")}: <a href={/^https?:/i.test(e.website) ? e.website : `https://${e.website}`}>{e.website}</a>
                          </span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                  {e.country_code === "DE" && e.representatives.length ? (
                    <>
                      <dt>{L("responsible")}</dt>
                      <dd>
                        <span>{e.representatives[0].name}</span>
                        {e.address_lines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {!e.register && !e.vat_id ? (
                  <p className="mt-4 text-sm text-muted-foreground">{L("pending")}</p>
                ) : null}
              </article>
            ))}
          </div>

          {rows && rows.length ? (
            <section className="legal-entity" lang={lang}>
              <h2 className="font-display text-title font-semibold">{L("disputes")}</h2>
              <p className="mt-3">{L("disputesText")}</p>
            </section>
          ) : null}
        </PageContainer>
      </section>
    </PageShell>
  );
}

import * as React from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRecordMeta } from "@/lib/use-share-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Markdown } from "@/components/ui/markdown";
import { ButtonLink } from "@/components/ui/button";
import { getLang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { dateFmt } from "@/lib/format";
import {
  documentPdfUrl,
  getPublicDocument,
  type DocumentLang,
  type PublicDocument,
} from "@/lib/brand-api";
import { NotFoundPage } from "@/features/not-found/not-found-page";
import { PageHero } from "@/components/site/page-hero";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import "@/components/site/brand.css";
import "@/components/site/brand-i18n";
import "./trust-i18n";

/**
 * One published trust document (`/trust/:key`), or the privacy policy
 * (`/legal/privacy`), exactly as the Publish button froze it: the same copy
 * the PDF is printed from.
 *
 * ── A LANGUAGE SWITCH ONLY WHERE THE DOCUMENT HAS TWO ─────────────────────
 *
 * The site is one language for an English-only tenant, and stays so. The
 * privacy policy is the exception the owner asked for (decision 19): it is
 * owed in German to a German reader, so when a document was published in more
 * than one language, the reader chooses here, and the PDF follows the choice.
 */
const LANG_NAME: Record<DocumentLang, string> = { en: "English", fr: "Français", de: "Deutsch" };

export function DocumentPage({ docKey }: { docKey?: string }) {
  const { t } = useTranslation();
  const params = useParams();
  const key = docKey || params.key || "";
  const siteLang = getLang();
  const [lang, setLang] = React.useState<DocumentLang>(siteLang === "fr" ? "fr" : "en");
  const [doc, setDoc] = React.useState<PublicDocument | null | undefined>(undefined);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    getPublicDocument(key, lang, controller.signal)
      .then((d) => alive && setDoc(d))
      .catch(() => alive && setDoc(null));
    return () => {
      alive = false;
      controller.abort();
    };
  }, [key, lang]);

  useRecordMeta(doc ? doc.title : null, doc && doc.summary ? doc.summary : null);

  if (doc === null) return <NotFoundPage />;

  return (
    <PageShell overlayHeader label={doc ? doc.title : t("site.trust.title")} footer>
      {/* The title and summary sit on the page's photograph, like every other
          page (owner's review of staging, 25 Nov 2026). The privacy policy has
          its own slot; a trust document shares the Trust page's. */}
      <PageHero slot={key === "privacy-policy" ? "privacy-hero" : "trust-hero"}>
        <PageContainer size="reading" className="relative">
          {key === "privacy-policy" ? null : <BadgePill onDark>{t("site.trust.eyebrow")}</BadgePill>}
          <div lang={doc ? doc.lang : undefined}>
            <SectionHead
              className={key === "privacy-policy" ? undefined : "mt-4"}
              as="h1"
              titleClass="hero-title"
              onDark
              title={doc ? doc.title : " "}
              lead={doc && doc.summary ? doc.summary : undefined}
            />
          </div>
        </PageContainer>
      </PageHero>
      <section className="band doc-page">
        <PageContainer size="reading">
          {doc ? (
            <>
              <header className="doc-head" lang={doc.lang}>
                <p className="eyebrow">
                  <a href={p("/trust")}>{t("site.trust.allDocuments")}</a>
                </p>
                <dl className="doc-facts">
                  {doc.version_label ? (
                    <div>
                      <dt>{t("site.trust.version")}</dt>
                      <dd>{doc.version_label}</dd>
                    </div>
                  ) : null}
                  {doc.effective_on ? (
                    <div>
                      <dt>{t("site.trust.effective")}</dt>
                      <dd>{dateFmt(doc.effective_on)}</dd>
                    </div>
                  ) : null}
                  {doc.approved_by ? (
                    <div>
                      <dt>{t("site.trust.approvedBy")}</dt>
                      <dd>{doc.approved_by}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{t("site.trust.published")}</dt>
                    <dd>{dateFmt(doc.published_at)}</dd>
                  </div>
                </dl>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <ButtonLink href={documentPdfUrl(doc.key, doc.lang)} variant="outline" download>
                    {t("site.brand.downloadPdf")}
                  </ButtonLink>
                  {doc.languages.length > 1 ? (
                    <div className="lang-switch" role="group" aria-label={t("site.trust.language")}>
                      {doc.languages.map((l) => (
                        <button
                          key={l}
                          type="button"
                          lang={l}
                          aria-pressed={l === doc.lang}
                          onClick={() => setLang(l)}
                        >
                          {LANG_NAME[l]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </header>
              <div className="doc-body" lang={doc.lang}>
                <Markdown text={doc.body} />
              </div>
            </>
          ) : (
            <div className="doc-head" aria-busy="true">
              <div className="h-5 w-1/3 rounded bg-muted" />
              <div className="mt-4 h-5 w-full rounded bg-muted" />
            </div>
          )}
        </PageContainer>
      </section>
    </PageShell>
  );
}

export function PrivacyPage() {
  return <DocumentPage docKey="privacy-policy" />;
}

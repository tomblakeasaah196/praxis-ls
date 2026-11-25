import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { SectionHead } from "@/components/site/section-head";
import { PhotoBand } from "@/components/site/photo-band";
import { CredentialStrip, MembershipList } from "@/components/site/proof-bands";
import { BadgePill } from "@/components/ui/badge-pill";
import { getLang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { dateFmt } from "@/lib/format";
import { useSitePage } from "@/lib/use-site-page";
import { afterPaint } from "@/lib/after-paint";
import { aboutSections } from "@/lib/about-sections";
import {
  heroBlock,
  getPublicAbout,
  getPublicProof,
  pickBilingual,
  EMPTY_PROOF,
  type PublicProof,
} from "@/lib/site-api";
import { listPublicDocuments, useSiteImages, type PublicDocumentCard } from "@/lib/brand-api";
import "./trust-i18n";

/**
 * `/trust`: Trust and Compliance (PR 4, item 6). The page an NGO's or a UN
 * agency's procurement officer opens before they hand over a shipment: how the
 * company is governed, every published policy with its version and date, the
 * certifications and memberships that can be checked, and the legal pages.
 *
 * The hero's words are the tenant's `trust` page (Settings › Website › Pages)
 * when written; the governance paragraph is the About page's Standards text,
 * written once and read in both places.
 */
export function TrustPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const images = useSiteImages();
  const { page } = useSitePage("trust");
  const hero = heroBlock(page);
  const [docs, setDocs] = React.useState<PublicDocumentCard[] | null>(null);
  const [proof, setProof] = React.useState<PublicProof>(EMPTY_PROOF);
  const [standards, setStandards] = React.useState("");

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      const signal = controller.signal;
      listPublicDocuments({ lang, signal }).then((d) => alive && setDocs(d));
      getPublicProof({ signal }).then((pr) => alive && setProof(pr));
      getPublicAbout({ lang, signal }).then(
        (a) => alive && setStandards(aboutSections(a.sections, lang).standards.text),
      );
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, [lang]);

  const title = (hero && pickBilingual(hero.title, lang)) || t("site.trust.title");
  const lead = (hero && hero.lead && pickBilingual(hero.lead, lang)) || t("site.trust.sub");
  useDocumentMeta({ title, description: lead });

  const policies = (docs || []).filter((d) => d.kind === "POLICY");
  const hasProof = proof.credentials.length > 0 || proof.partners.some((x) => x.kind === "network");

  return (
    <PageShell label={title} footer>
      <PhotoBand image={images["trust-hero"]} size="hero" priority>
        <BadgePill onDark>{(hero && hero.kicker && pickBilingual(hero.kicker, lang)) || t("site.trust.eyebrow")}</BadgePill>
        <SectionHead className="mt-4" as="h1" titleClass="hero-title" onDark title={title} lead={lead} leadClass="about-hero-lead" />
      </PhotoBand>

      {standards ? (
        <section className="band">
          <PageContainer>
            <div className="about-prose max-w-prose">
              <p className="text-lg">{standards}</p>
            </div>
          </PageContainer>
        </section>
      ) : null}

      <section className={standards ? "band rule-top" : "band"}>
        <PageContainer>
          <SectionHead as="h2" title={t("site.trust.policiesTitle")} />
          {policies.length ? (
            <ul className="doc-list">
              {policies.map((d) => (
                <li key={d.key}>
                  <Link to={p(`/trust/${encodeURIComponent(d.key)}`)} className="doc-card">
                    <span className="doc-card-title">{d.title}</span>
                    {d.summary ? <span className="doc-card-summary">{d.summary}</span> : null}
                    <span className="doc-card-meta">
                      {[
                        d.version_label ? `${t("site.trust.version")} ${d.version_label}` : null,
                        d.effective_on ? `${t("site.trust.effective")} ${dateFmt(d.effective_on)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : docs ? (
            <p className="mt-6 text-muted-foreground">{t("site.trust.notFound")}</p>
          ) : null}
        </PageContainer>
      </section>

      {hasProof ? (
        <section className="band band-muted">
          <PageContainer>
            {proof.partners.some((x) => x.kind === "network") ? (
              <>
                <SectionHead as="h2" title={t("site.trust.membershipsTitle")} />
                <MembershipList proof={proof} className="mt-6" />
              </>
            ) : null}
            <CredentialStrip proof={{ ...proof, partners: [] }} />
          </PageContainer>
        </section>
      ) : null}

      <section className="band rule-top">
        <PageContainer>
          <SectionHead as="h2" title={t("site.trust.legalTitle")} />
          <ul className="about-policies mt-6 max-w-prose">
            <li>
              <Link to={p("/legal/impressum")}>{t("site.footer.impressum")}</Link>
            </li>
            <li>
              <Link to={p("/legal/privacy")}>{t("site.footer.privacy")}</Link>
            </li>
          </ul>
        </PageContainer>
      </section>
    </PageShell>
  );
}

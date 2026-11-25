import * as React from "react";
import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { SectionHead } from "@/components/site/section-head";
import { PhotoBand } from "@/components/site/photo-band";
import { MembershipList } from "@/components/site/proof-bands";
import "@/components/site/brand.css";
import { monogram } from "@/components/site/leader-card";
import { BadgePill } from "@/components/ui/badge-pill";
import { ButtonLink } from "@/components/ui/button";
import { getLang, type Lang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { useSitePage } from "@/lib/use-site-page";
import { afterPaint } from "@/lib/after-paint";
import { aboutSections, type AboutSectionsView } from "@/lib/about-sections";
import {
  EMPTY_PROOF,
  getPublicAbout,
  getPublicProof,
  heroBlock,
  listPublicEntities,
  mediaSrcSet,
  mediaUrl,
  pickBilingual,
  type Bilingualish,
  type PublicEntity,
  type PublicLeader,
  type PublicProof,
  type SitePage,
} from "@/lib/site-api";
import { getLegalEntities, useSiteImages, type LegalEntity } from "@/lib/brand-api";
import "@/components/site/brand-i18n";
import "./partners-i18n";
import { phoneDisplay, phoneHref } from "@/lib/brand-api";

/**
 * `/partners`: For Partners (PR 4, item 7). Written for the overseas agent or
 * forwarder deciding whether to hand us a shipment: what we handle and where,
 * how to nominate a shipment to us, the networks we belong to (with numbers
 * they can check), the people to write to, and a form that reaches the desk
 * that handles agents.
 *
 * ── THE WORDS ARE THE TENANT'S PAGE ───────────────────────────────────────
 *
 * The hero, the "what we handle" list and the nomination steps are the
 * tenant's `partners` page (Settings › Website › Pages: a Hero block and two
 * How It Works blocks, in that order; a Card Grid, if a page has one, still
 * takes the first list's place). One build serves every tenant, so no sentence about
 * Douala or Mannheim is written into this file; what the file supplies is the
 * structure and the furniture.
 */

/** The form is the last band and carries the upload engine; it is its own
 *  chunk so the page's first paint is the hero, not the form's code. */
const ContactForm = React.lazy(() =>
  import("@/components/site/contact-form").then((m) => ({ default: m.ContactForm })),
);

type Card = { title: string; text: string };
type List = { title: string; items: Card[] };

/**
 * The page's titled lists, in the order the tenant placed them: every card grid
 * and every How It Works block. The page editor offers How It Works, so the
 * usual page is two of those; reading both shapes keeps a page built either
 * way working.
 */
function lists(page: SitePage | null, lang: Lang): List[] {
  return (page?.blocks || [])
    .filter((b) => b.type === "card_grid" || b.type === "feature_list")
    .map((block) => {
      const c = block.content || {};
      const items = (Array.isArray(c.items) ? c.items : [])
        .map((i) => {
          const r = (i || {}) as { title?: Bilingualish; text?: Bilingualish };
          return { title: pickBilingual(r.title, lang), text: pickBilingual(r.text, lang) };
        })
        .filter((i) => i.title);
      return { title: pickBilingual(c.title as Bilingualish, lang), items };
    })
    .filter((l) => l.items.length);
}

type Data = {
  proof: PublicProof;
  entities: PublicEntity[];
  legal: LegalEntity[];
  leaders: PublicLeader[];
  sections: AboutSectionsView | null;
};

export function PartnersPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const images = useSiteImages();
  const { page } = useSitePage("partners");
  const hero = heroBlock(page);
  const [handles, steps] = lists(page, lang);
  const [data, setData] = React.useState<Data>({
    proof: EMPTY_PROOF,
    entities: [],
    legal: [],
    leaders: [],
    sections: null,
  });

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const put = (patch: Partial<Data>) => alive && setData((d) => ({ ...d, ...patch }));
    const cancel = afterPaint(() => {
      const signal = controller.signal;
      getPublicProof({ signal }).then((proof) => put({ proof }));
      listPublicEntities({ signal })
        .then((entities) => put({ entities: Array.isArray(entities) ? entities : [] }))
        .catch(() => {
          /* silent-catch: PRESENTATION. No published company is the normal
             state for a new tenant; the offices block is not drawn.
             doc/ERROR_HANDLING.md */
        });
      getLegalEntities(signal).then((legal) => put({ legal }));
      getPublicAbout({ lang, signal }).then((a) =>
        put({ leaders: a.leaders, sections: aboutSections(a.sections, lang) }),
      );
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, [lang]);

  const title = (hero && pickBilingual(hero.title, lang)) || t("site.partnersPage.title");
  const lead = (hero && hero.lead && pickBilingual(hero.lead, lang)) || t("site.partnersPage.sub");
  useDocumentMeta({ title, description: lead });

  // Named contacts: the group's people and each company's people who have been
  // made a contact for partners. The server publishes an email and a phone only
  // for those.
  const contacts = [
    ...data.leaders,
    ...data.entities.flatMap((e) => (Array.isArray(e.leaders) ? (e.leaders as PublicLeader[]) : [])),
  ].filter((l, i, all) => l.partner_desk && all.findIndex((x) => x.id === l.id) === i);

  const offices = officeList(data, lang);

  return (
    <PageShell label={title} footer>
      <PhotoBand image={images["partners-hero"]} size="hero" priority>
        <BadgePill onDark>
          {(hero && hero.kicker && pickBilingual(hero.kicker, lang)) || t("site.partnersPage.eyebrow")}
        </BadgePill>
        <SectionHead className="mt-4" as="h1" titleClass="hero-title" onDark title={title} lead={lead} leadClass="about-hero-lead" />
        <div className="about-actions">
          <ButtonLink href="#partner-form" variant="onHero" size="lg">
            {t("site.partnersPage.formTitle")}
          </ButtonLink>
          <ButtonLink to={p("/quote")} variant="outlineOnHero" size="lg">
            {t("site.brand.requestQuote")}
          </ButtonLink>
        </div>
      </PhotoBand>

      {handles ? (
        <section className="band">
          <PageContainer>
            {handles.title ? <SectionHead as="h2" title={handles.title} /> : null}
            <ul className="about-principles">
              {handles.items.map((c, i) => (
                <li key={c.title}>
                  <span className="about-principle-n num" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{c.title}</h3>
                    {c.text ? <p>{c.text}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </PageContainer>
        </section>
      ) : null}

      {steps ? (
        <section className="band band-muted">
          <PageContainer>
            {steps.title ? <SectionHead as="h2" title={steps.title} /> : null}
            <ol className="about-principles">
              {steps.items.map((s, i) => (
                <li key={i}>
                  <span className="about-principle-n num" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{s.title}</h3>
                    {s.text ? <p>{s.text}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </PageContainer>
        </section>
      ) : null}

      {offices.length || contacts.length || data.proof.partners.some((x) => x.kind === "network") ? (
        <section className="band rule-top">
          <PageContainer>
            {offices.length ? (
              <>
                <SectionHead as="h2" title={t("site.partnersPage.officesTitle")} />
                <ul className="about-offices" style={{ "--cols": String(Math.min(offices.length, 3)) } as React.CSSProperties}>
                  {offices.map((o) => (
                    <li key={o.id} className="about-office">
                      <div className="about-office-body">
                        <h3 className="about-office-heading">{o.heading}</h3>
                        {o.label ? <p className="about-office-label">{o.label}</p> : null}
                        {o.lines.length ? (
                          <address className="about-office-address">
                            {o.lines.map((line) => (
                              <span key={line}>{line}</span>
                            ))}
                          </address>
                        ) : null}
                        {o.phone || o.email ? (
                          <p className="about-office-contact">
                            {o.phone ? <a href={phoneHref(o.phone)}>{phoneDisplay(o.phone)}</a> : null}
                            {o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : null}
                          </p>
                        ) : null}
                        {o.services ? <p className="about-office-services">{o.services}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {contacts.length ? (
              <div className={offices.length ? "mt-14" : undefined}>
                <SectionHead as="h2" title={t("site.partnersPage.contactsTitle")} />
                <ul className="partner-contacts">
                  {contacts.map((c) => (
                    <PartnerContact key={c.id} leader={c} />
                  ))}
                </ul>
              </div>
            ) : null}

            {data.proof.partners.some((x) => x.kind === "network") ? (
              <div className={offices.length || contacts.length ? "mt-14" : undefined}>
                <SectionHead as="h2" title={t("site.partnersPage.membershipsTitle")} />
                <MembershipList proof={data.proof} className="mt-6" />
              </div>
            ) : null}
          </PageContainer>
        </section>
      ) : null}

      <section id="partner-form" className="band band-muted scroll-mt-[var(--sticky-top)]">
        <PageContainer size="reading">
          <SectionHead as="h2" title={t("site.partnersPage.formTitle")} lead={t("site.partnersPage.formLead")} />
          <div className="mt-8">
            <React.Suspense fallback={<div className="h-96" aria-hidden />}>
              <ContactForm defaultType="PARTNERSHIP" />
            </React.Suspense>
          </div>
        </PageContainer>
      </section>
    </PageShell>
  );
}

/** The offices, from the About page's list when the tenant has written one,
 *  otherwise every published company. Addresses are the companies' records. */
function officeList(data: Data, lang: Lang) {
  const fromSections = data.sections?.offices.items || [];
  const base = fromSections.length
    ? fromSections.map((o) => ({ id: o.entityId, heading: o.heading, label: o.label, services: o.services }))
    : data.legal.map((e) => ({ id: e.id, heading: "", label: "", services: "" }));
  return base
    .map((o) => {
      const facts = data.legal.find((e) => e.id === o.id) || null;
      const entity = data.entities.find((e) => e.id === o.id) || null;
      if (!facts && !entity) return null;
      return {
        ...o,
        heading:
          o.heading ||
          (facts && facts.address_lines.slice(-2).join(", ")) ||
          (entity && (entity.trading_name || entity.legal_name)) ||
          "",
        lines: facts ? facts.address_lines : [],
        phone: (entity && entity.phone) || (facts && facts.phone) || null,
        email: (entity && entity.email) || (facts && facts.email) || null,
        lang,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);
}

function PartnerContact({ leader }: { leader: PublicLeader }) {
  const { t } = useTranslation();
  const lang = getLang();
  const role = pickBilingual(leader.role, lang);
  const src = mediaUrl(leader.photo_id);
  const webp = mediaSrcSet(leader.photo_id, leader.photo_variants, "webp");
  return (
    <li className="partner-contact">
      <span className="partner-contact-photo">
        {src ? (
          <picture>
            {webp ? <source type="image/webp" srcSet={webp} sizes="4.5rem" /> : null}
            <img src={src} alt={t("site.about.portraitAlt", { name: leader.name })} loading="lazy" decoding="async" />
          </picture>
        ) : (
          <span className="leader-monogram" aria-hidden>
            {monogram(leader.name)}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-semibold">{leader.name}</span>
        {role ? <span className="text-sm text-muted-foreground">{role}</span> : null}
        {leader.email ? <a href={`mailto:${leader.email}`}>{leader.email}</a> : null}
        {leader.phone ? <a href={phoneHref(leader.phone)}>{phoneDisplay(leader.phone)}</a> : null}
      </span>
    </li>
  );
}

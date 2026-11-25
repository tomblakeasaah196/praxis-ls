import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { StagedLines, PullQuote } from "@/components/ui/type";
import { ButtonLink } from "@/components/ui/button";
import { LeaderCard, LeaderGrid, monogram } from "@/components/site/leader-card";
import { PhotoBand } from "@/components/site/photo-band";
import { SitePhoto } from "@/components/site/site-photo";
import { useSiteSwitches } from "@/lib/site-switches";
import {
  CarrierMarks,
  ClientBand,
  ClientLogoBand,
  CredentialStrip,
  MembershipList,
} from "@/components/site/proof-bands";
import { GlobeIcon, ShieldIcon } from "@/components/ui/icons";
import { getLang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { afterPaint } from "@/lib/after-paint";
import { aboutSections, type AboutSectionsView } from "@/lib/about-sections";
import {
  getLegalEntities,
  listPublicDocuments,
  useSiteImages,
  type LegalEntity,
  type PublicDocumentCard,
  type SiteImages,
} from "@/lib/brand-api";
import {
  EMPTY_ABOUT,
  EMPTY_PROOF,
  getPublicAbout,
  getPublicProof,
  hasEsg,
  listPublicEntities,
  mediaSrcSet,
  mediaUrl,
  pickBilingual,
  type PublicAbout,
  type PublicEntity,
  type PublicLeader,
  type PublicProof,
} from "@/lib/site-api";
import "@/components/site/brand-i18n";
import "./about-i18n";

/**
 * `/about`, rebuilt for website v2 (doc/smartls-website/ENGINEERING_GUIDE.md
 * PR 4, item 5): a statement, the facts a visitor can check, the story, how
 * the company works, the leader's message, the offices, who it moves for,
 * its standards, and a closing invitation.
 *
 * ── LIGHT PAGES, DARK PHOTOGRAPHIC BANDS ──────────────────────────────────
 *
 * The owner's choice (decision 12). The hero, the sectors band and the
 * closing band are photographs under the hero's measured scrim; everything
 * between them is a light page. Every photograph is the tenant's own, set in
 * Settings › Website › Photographs; an empty slot leaves a plain band rather
 * than a hole.
 *
 * ── EVERY SECTION IS THE TENANT'S, AND EVERY ONE IS OPTIONAL ──────────────
 *
 * The words come from `site_about.sections` (14660) and the older About
 * fields; the dictionary supplies only a heading a tenant has not written. A
 * section with nothing in it is not drawn. And because one build serves every
 * tenant, the older blocks (mission and vision, the timeline, the ESG
 * triptych, the company network) still draw for a tenant who has written
 * them: nothing is taken away from anybody by rebuilding this page for one.
 *
 * ── NO PERSON IS INVENTED ─────────────────────────────────────────────────
 *
 * A portrait is a leader's own photograph (the upload refuses a generated
 * one), and a leader without one is drawn as a monogram. The scene
 * photographs in the bands picture places and cargo, never staff.
 */

/* The older page's set pieces, drawn only for a tenant who has written them
   (and the network only with the corridors switch on): their own chunks, so
   the rebuilt page's first paint does not carry them for everybody else. */
const EsgTriptych = React.lazy(() =>
  import("@/components/site/esg-triptych").then((m) => ({ default: m.EsgTriptych })),
);
const EntityNetwork = React.lazy(() =>
  import("@/components/site/entity-network").then((m) => ({ default: m.EntityNetwork })),
);
const Timeline = React.lazy(() =>
  import("@/components/site/timeline").then((m) => ({ default: m.Timeline })),
);

type AboutData = {
  about: PublicAbout;
  entities: PublicEntity[];
  legal: LegalEntity[];
  proof: PublicProof;
  documents: PublicDocumentCard[];
  /** The story read has answered (with data or with the empty answer). */
  aboutLoaded: boolean;
};

/** The five reads, in parallel, after paint. None is a precondition of
 *  another, and every failure is the empty answer: a band that is not drawn. */
function useAboutData(): AboutData {
  const lang = getLang();
  const [data, setData] = React.useState<AboutData>({
    about: EMPTY_ABOUT,
    entities: [],
    legal: [],
    proof: EMPTY_PROOF,
    documents: [],
    aboutLoaded: false,
  });

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const put = (patch: Partial<AboutData>) => alive && setData((d) => ({ ...d, ...patch }));
    const cancel = afterPaint(() => {
      const signal = controller.signal;
      getPublicAbout({ lang, signal }).then((about) => put({ about, aboutLoaded: true }));
      listPublicEntities({ signal })
        .then((rows) => put({ entities: Array.isArray(rows) ? rows : [] }))
        .catch(() => {
          /* silent-catch: PRESENTATION. `public_enabled` is off until somebody
             turns it on (13787), so an empty answer is the NORMAL one and marks
             nothing. doc/ERROR_HANDLING.md */
        });
      getLegalEntities(signal).then((legal) => put({ legal }));
      getPublicProof({ signal }).then((proof) => put({ proof }));
      listPublicDocuments({ lang, signal }).then((documents) => put({ documents }));
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, [lang]);

  return data;
}

export function AboutPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const { corridors: networkOn } = useSiteSwitches();
  const { about, entities, legal, proof, documents, aboutLoaded } = useAboutData();
  const images = useSiteImages();
  const s = aboutSections(about.sections, lang);

  useDocumentMeta({
    title: t("site.about.title"),
    description: about.summary || t("site.about.sub"),
  });

  /* The leader who signs the message, when the tenant has chosen one. A
     tenant on the older page had its FIRST group leader as the anchor; that
     stays the rule when no message has been written. */
  const signer = s.message.leaderId ? about.leaders.find((l) => l.id === s.message.leaderId) || null : null;
  const hasMessage = Boolean(signer && s.message.paragraphs.length);
  const [legacyAnchor, ...legacyOthers] = about.leaders;
  const others = hasMessage ? about.leaders.filter((l) => l.id !== signer!.id) : legacyOthers;
  const policies = documents.filter((d) => d.kind === "POLICY");
  const clientsWithoutMarks =
    proof.partners.some((x) => x.kind === "client") &&
    !proof.partners.some((x) => x.kind === "client" && x.logo_id);
  const standardsShown = Boolean(s.standards.text || policies.length);
  const hasMemberships = proof.partners.some((x) => x.kind === "network");

  return (
    <PageShell label={t("site.about.title")} footer>
      <AboutHero about={about} s={s} images={images} loaded={aboutLoaded} />

      {s.credentials.length ? <CredentialsRow items={s.credentials} /> : null}

      {s.story.paragraphs.length ? (
        <section className="band about-split">
          <PageContainer className="about-split-grid">
            <div className="about-split-text">
              <SectionHead as="h2" title={s.story.title || t("site.aboutPage.storyTitle")} />
              <div className="about-prose">
                {s.story.paragraphs.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </div>
            {images["about-story"] ? (
              <figure className="about-split-art about-art-tall">
                <SitePhoto image={images["about-story"]} sizes="(min-width: 1024px) 40vw, 100vw" />
              </figure>
            ) : null}
          </PageContainer>
        </section>
      ) : null}

      {/* The older page's mission and vision, for a tenant who wrote them. */}
      {about.mission || about.vision ? (
        <Section divided eyebrow={t("site.about.storyKicker")} title={t("site.about.storyTitle")}>
          <div className="grid gap-8 lg:grid-cols-2">
            {about.mission ? <PullQuote cite={t("site.about.mission")}>{about.mission}</PullQuote> : null}
            {about.vision ? <PullQuote cite={t("site.about.vision")}>{about.vision}</PullQuote> : null}
          </div>
        </Section>
      ) : null}

      {about.principles.length ? (
        <section className="band band-muted about-split">
          <PageContainer className={images["about-principles"] ? "about-split-grid is-reversed" : undefined}>
            {images["about-principles"] ? (
              <figure className="about-split-art">
                <SitePhoto image={images["about-principles"]} sizes="(min-width: 1024px) 40vw, 100vw" />
              </figure>
            ) : null}
            <div className="about-split-text">
              <SectionHead
                as="h2"
                title={s.principlesTitle || t("site.aboutPage.principlesTitle")}
              />
              <ol className="about-principles">
                {about.principles.map((principle, i) => (
                  <li key={principle.label || i}>
                    <span className="about-principle-n num" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{principle.label}</h3>
                      {principle.text ? <p>{principle.text}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </PageContainer>
        </section>
      ) : null}

      {hasMessage ? (
        <LeaderMessage leader={signer!} title={s.message.title || t("site.aboutPage.messageTitle")} paragraphs={s.message.paragraphs} />
      ) : !s.message.leaderId && legacyAnchor ? (
        <Section variant="muted" divided eyebrow={t("site.about.messageKicker")} title={t("site.about.messageTitle")}>
          <LeaderCard leader={legacyAnchor} featured />
        </Section>
      ) : null}

      {about.timeline.length ? (
        <Section divided eyebrow={t("site.about.timelineKicker")} title={t("site.about.timelineTitle")}>
          <React.Suspense fallback={null}>
            <Timeline entries={about.timeline} />
          </React.Suspense>
        </Section>
      ) : null}

      {others.length ? (
        <Section divided eyebrow={t("site.about.peopleKicker")} title={t("site.about.peopleTitle")}>
          <LeaderGrid leaders={others} />
        </Section>
      ) : null}

      {s.offices.items.length ? (
        <Offices s={s} entities={entities} legal={legal} images={images} />
      ) : networkOn && entities.length ? (
        <Section
          divided
          eyebrowIcon={GlobeIcon}
          eyebrow={t("site.about.networkKicker")}
          title={t("site.about.networkTitle")}
          lead={t("site.about.networkLead")}
        >
          <React.Suspense fallback={null}>
            <EntityNetwork entities={entities} />
          </React.Suspense>
        </Section>
      ) : null}

      {s.sectors.items.length ? (
        <PhotoBand image={images["about-sectors"]}>
          <SectionHead
            as="h2"
            onDark
            title={s.sectors.title || t("site.aboutPage.sectorsTitle")}
          />
          <ul className="about-sectors">
            {s.sectors.items.map((sector) => (
              <li key={sector.title}>
                <h3>{sector.title}</h3>
                {sector.text ? <p>{sector.text}</p> : null}
              </li>
            ))}
          </ul>
        </PhotoBand>
      ) : null}

      <ClientLogoBand proof={proof} caption={s.sectors.clientsCaption || undefined} />

      {hasEsg(about.esg) ? (
        <Section divided eyebrow={t("site.esg.kicker")} title={t("site.esg.title")} accent={t("site.esg.titleAccent")}>
          <React.Suspense fallback={null}>
            <EsgTriptych esg={about.esg} />
          </React.Suspense>
        </Section>
      ) : null}

      {standardsShown ? (
        <section className="band about-split">
          <PageContainer className={images["about-standards"] ? "about-split-grid" : undefined}>
            <div className="about-split-text">
              <SectionHead
                as="h2"
                title={s.standards.title || t("site.aboutPage.standardsTitle")}
              />
              {s.standards.text ? (
                <div className="about-prose">
                  <p>{s.standards.text}</p>
                </div>
              ) : null}
              {policies.length ? (
                <>
                  <h3 className="about-subhead">{t("site.aboutPage.policiesTitle")}</h3>
                  <ul className="about-policies">
                    {policies.map((d) => (
                      <li key={d.key}>
                        <Link to={p(`/trust/${encodeURIComponent(d.key)}`)}>{d.title}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <MembershipList proof={proof} className="mt-8" />
            </div>
            {images["about-standards"] ? (
              <figure className="about-split-art">
                <SitePhoto image={images["about-standards"]} sizes="(min-width: 1024px) 40vw, 100vw" />
              </figure>
            ) : null}
          </PageContainer>
        </section>
      ) : null}

      <CarrierMarks proof={proof} />

      {proof.credentials.length || clientsWithoutMarks || (!standardsShown && hasMemberships) ? (
        <Section divided eyebrowIcon={ShieldIcon} eyebrow={t("site.about.proofKicker")} title={t("site.about.proofTitle")}>
          {/* Memberships are listed under the standards when that section is
              drawn; otherwise this strip carries them, as it always has. */}
          <CredentialStrip proof={standardsShown ? { ...proof, partners: [] } : proof} />
          {/* The older page's static client list, where the moving band has
              nothing to show because no client has a logo yet: a name is
              still a reference. */}
          {clientsWithoutMarks ? <ClientBand proof={proof} /> : null}
        </Section>
      ) : null}

      {s.closing.title ? (
        <PhotoBand image={images["about-closing"]}>
          <SectionHead
            as="h2"
            onDark
            title={s.closing.title}
            lead={s.closing.text || undefined}
          />
          <div className="about-actions">
            <ButtonLink to={p("/quote")} variant="onHero" size="lg">
              {t("site.brand.requestQuote")}
            </ButtonLink>
            <ButtonLink to={p("/partners")} variant="outlineOnHero" size="lg">
              {t("site.brand.forPartners")}
            </ButtonLink>
          </div>
        </PhotoBand>
      ) : null}
    </PageShell>
  );
}

/** The hero: the statement, the lead and two ways forward, over the page's
 *  first photograph. A tenant with no headline keeps the older two-line title. */
function AboutHero({
  about,
  s,
  images,
  loaded,
}: {
  about: PublicAbout;
  s: AboutSectionsView;
  images: SiteImages;
  loaded: boolean;
}) {
  const { t } = useTranslation();
  /* Until the story read answers, the headline and lead are held back (their
     space kept), rather than painting the dictionary's fallback title and
     swapping it for the tenant's a moment later: a visitor saw "The Men and
     Women Behind the Freight" flash before "We Hold Both Ends of the Line". */
  const fallback = loaded && !about.headline;
  return (
    <PhotoBand image={images["about-hero"]} size="hero" priority labelledBy="about-title">
      <BadgePill onDark>{s.heroEyebrow || t("site.aboutPage.eyebrow")}</BadgePill>
      <SectionHead
        className="mt-4"
        as="h1"
        titleClass="hero-title"
        onDark
        /* F-17: the LCP element on this route. `paintImmediately` paints the
           words at full opacity and staggers only the rise. */
        title={
          <span id="about-title">
            {about.headline ? (
              <StagedLines paintImmediately text={about.headline} />
            ) : fallback ? (
              <StagedLines paintImmediately text={t("site.about.titleMain")} />
            ) : (
              <span className="invisible" aria-hidden>
                {"\u00a0"}
              </span>
            )}
          </span>
        }
        accent={fallback ? t("site.about.titleAccent") : undefined}
        lead={about.summary || (loaded ? t("site.about.sub") : undefined)}
        leadClass="about-hero-lead"
      />
      <div className="about-actions">
        <ButtonLink to={p("/quote")} variant="onHero" size="lg">
          {t("site.brand.requestQuote")}
        </ButtonLink>
        <ButtonLink to={p("/contact")} variant="outlineOnHero" size="lg">
          {t("site.brand.talkToUs")}
        </ButtonLink>
      </div>
      {!s.credentials.length && (about.foundedYear || about.headquarters) ? (
        <dl className="about-facts">
          {about.foundedYear ? (
            <div>
              <dt>{t("site.about.founded")}</dt>
              <dd>{about.foundedYear}</dd>
            </div>
          ) : null}
          {about.headquarters ? (
            <div>
              <dt>{t("site.about.hq")}</dt>
              <dd>{about.headquarters}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </PhotoBand>
  );
}

/** Four facts a visitor can check, each a label over a value. No counters. */
function CredentialsRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <section className="band about-credentials-band" aria-label={items.map((i) => i.label).join(", ")}>
      <PageContainer>
        <dl className="about-credentials" style={{ "--cols": String(Math.min(items.length, 4)) } as React.CSSProperties}>
          {items.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
            </div>
          ))}
        </dl>
      </PageContainer>
    </section>
  );
}

/** The leader's message: a real portrait (or a monogram), the paragraphs, and
 *  the signature set as a signature, not as a byline. */
function LeaderMessage({ leader, title, paragraphs }: { leader: PublicLeader; title: string; paragraphs: string[] }) {
  const { t } = useTranslation();
  const lang = getLang();
  const role = pickBilingual(leader.role, lang);
  const src = mediaUrl(leader.photo_id);
  const avif = mediaSrcSet(leader.photo_id, leader.photo_variants, "avif");
  const webp = mediaSrcSet(leader.photo_id, leader.photo_variants, "webp");
  const [lead, ...rest] = paragraphs;
  return (
    <section className="band rule-top about-message">
      <PageContainer className="about-message-grid">
        <figure className="about-message-portrait">
          {src ? (
            <picture>
              {avif ? <source type="image/avif" srcSet={avif} sizes="(min-width: 1024px) 28rem, 80vw" /> : null}
              {webp ? <source type="image/webp" srcSet={webp} sizes="(min-width: 1024px) 28rem, 80vw" /> : null}
              <img src={src} alt={t("site.about.portraitAlt", { name: leader.name })} loading="lazy" decoding="async" />
            </picture>
          ) : (
            <span className="leader-monogram" aria-hidden>
              {monogram(leader.name)}
            </span>
          )}
        </figure>
        <div className="about-message-text">
          <SectionHead as="h2" title={title} />
          <blockquote className="about-message-body">
            {lead ? <p className="about-message-lead">{lead}</p> : null}
            {rest.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </blockquote>
          <p className="about-signature">
            <span className="about-signature-name">{leader.name}</span>
            {role ? <span className="about-signature-role">{role}</span> : null}
          </p>
        </div>
      </PageContainer>
    </section>
  );
}

/** The offices: the place, what it does, and how to reach it. The address,
 *  phone and email are the company's own records, never retyped here. */
function Offices({
  s,
  entities,
  legal,
  images,
}: {
  s: AboutSectionsView;
  entities: PublicEntity[];
  legal: LegalEntity[];
  images: SiteImages;
}) {
  const { t } = useTranslation();
  const cards = s.offices.items
    .map((o, i) => ({
      o,
      i,
      entity: entities.find((e) => e.id === o.entityId) || null,
      facts: legal.find((e) => e.id === o.entityId) || null,
    }))
    .filter((c) => c.entity || c.facts);
  if (!cards.length) return null;
  return (
    <section className="band rule-top">
      <PageContainer>
        <SectionHead as="h2" title={s.offices.title || t("site.aboutPage.officesTitle")} />
        <ul className="about-offices" style={{ "--cols": String(Math.min(cards.length, 3)) } as React.CSSProperties}>
          {cards.map(({ o, i, entity, facts }) => {
            const phone = (entity && entity.phone) || (facts && facts.phone) || null;
            const email = (entity && entity.email) || (facts && facts.email) || null;
            const image = images[`about-office-${i + 1}`];
            return (
              <li key={o.entityId} className="about-office">
                {image ? (
                  <figure className="about-office-art">
                    <SitePhoto image={image} sizes="(min-width: 1024px) 40vw, 100vw" />
                  </figure>
                ) : null}
                <div className="about-office-body">
                  <h3 className="about-office-heading">
                    {o.heading || (facts && facts.address_lines.slice(-2).join(", ")) || (entity && (entity.trading_name || entity.legal_name))}
                  </h3>
                  {o.label ? <p className="about-office-label">{o.label}</p> : null}
                  {facts && facts.address_lines.length ? (
                    <address className="about-office-address">
                      {facts.address_lines.map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                    </address>
                  ) : null}
                  {phone || email ? (
                    <p className="about-office-contact">
                      {phone ? (
                        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                          <span className="sr-only">{t("site.brand.phone")} </span>
                          {phone}
                        </a>
                      ) : null}
                      {email ? (
                        <a href={`mailto:${email}`}>
                          <span className="sr-only">{t("site.brand.email")} </span>
                          {email}
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                  {o.services ? <p className="about-office-services">{o.services}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </PageContainer>
    </section>
  );
}

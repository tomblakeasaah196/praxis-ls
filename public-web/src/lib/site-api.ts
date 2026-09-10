/**
 * The tenant's own website content — `GET /api/tenant/public/site/pages/:key`.
 *
 * ── WHY THE PROOF STRIP READS FROM HERE AND NOWHERE ELSE ──────────────────
 *
 * A figures band is the one thing on a marketing page that is worth the most
 * when it is true and costs the most when it is not. `WEB_BUILD_BRIEF.md` N12
 * forbids inventing one, and a hardcoded "41,850 CBM managed" in a white-label
 * product is not a placeholder — it is a claim every other tenant would have to
 * find and delete before launch, and the ones they miss end up in front of a
 * procurement officer.
 *
 * So the numbers come from the tenant's own `stat_counters` blocks, and the
 * server has already resolved each one against its metric registry
 * (`site_content.metrics.js`) before it answers: where a block names a metric,
 * `value` is what the ledger says this morning; where it does not, `value` is
 * the literal the tenant typed. The renderer is never handed the choice, which
 * is why there is no `metric_key` in the payload below.
 *
 * A tenant with no home page, no published page, or the `website` package off
 * has no strip. That is the correct empty state and the caller draws nothing —
 * a band that says "statistics coming soon" is worse than no band.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────
 *
 * It is not a page renderer. The block library has fourteen types and the
 * marketing page is a hand-built scaffold, not a CMS view; consuming the two
 * stat types is a narrow, honest read of content the tenant already authors.
 * Anything more is the site-builder project, not this one.
 */
import { publicGet } from "./api";
import type { Lang } from "./i18n";

/** A bilingual string as the block schema stores it. FR is required upstream
 *  (`site_content.schema.js`), EN is optional — so FR is the fallback, never a
 *  blank. */
export type Bilingual = { fr: string; en?: string | null };

/** One figure. `value` is post-resolution: live where the block named a metric,
 *  the tenant's literal where it did not. */
export type StatCounter = {
  label: Bilingual;
  sublabel?: Bilingual | null;
  unit?: string | null;
  value: number;
};

/** One credential or short claim — the quieter row under the figures. */
export type StatChip = { label: Bilingual; value: Bilingual };

export type SiteBlock = {
  block_id: string;
  type: string;
  content: Record<string, unknown>;
};

export type SitePage = {
  key: string;
  blocks: SiteBlock[];
};

/**
 * The page the marketing home reads its figures from.
 *
 * `'home'` is the key migration 12753 names in the column's own comment
 * ("'home' | 'about' | … — stable, referenced by the router, never shown"), so
 * it is a convention the schema states rather than one this file invents.
 */
export const HOME_PAGE_KEY = "home";

/**
 * One published page, or `null`.
 *
 * Every failure is the same answer on purpose. An unknown key, an unpublished
 * page and a tenant without the `website` package are three different facts
 * server-side and one fact here: there is nothing to draw. Distinguishing them
 * would only give a marketing band a decision it should not be making, and the
 * band renders nothing in all three cases.
 */
export const getSitePage = (key: string): Promise<SitePage | null> =>
  publicGet<SitePage>(`/public/site/pages/${encodeURIComponent(key)}`).catch(
    () => null,
  );

/** A bilingual field read in the visitor's language, falling back to the other
 *  rather than to a blank — the same rule `services-api.pickText` follows for
 *  the tenant's service copy, and for the same reason. */
export function pickBilingual(
  value: Bilingual | null | undefined,
  lang: Lang,
): string {
  if (!value) return "";
  const wanted = lang === "fr" ? value.fr : value.en;
  if (typeof wanted === "string" && wanted) return wanted;
  const other = lang === "fr" ? value.en : value.fr;
  return typeof other === "string" ? other : "";
}

const itemsOf = (page: SitePage | null, type: string): unknown[] => {
  const block = (page?.blocks || []).find((b) => b.type === type);
  const items = block?.content?.items;
  return Array.isArray(items) ? items : [];
};

/**
 * The figures, from the FIRST `stat_counters` block on the page.
 *
 * First rather than merged: a tenant may repeat a headline number further down
 * their own page, and a strip that concatenated every stat block on the page
 * would show the same figure twice in one row. The strip is the top of the
 * page, so the top block is the one it means.
 *
 * Items with a non-finite value are dropped. `value` is `z.number()` in the
 * schema and the resolver only ever overwrites it with a finite number, so this
 * cannot fire today — it is here because a `NaN` rendered into a figures band
 * is the one failure mode that looks like a bug in the client's business rather
 * than in their website.
 */
export const statCounters = (page: SitePage | null): StatCounter[] =>
  itemsOf(page, "stat_counters").filter(
    (i): i is StatCounter =>
      !!i &&
      typeof i === "object" &&
      Number.isFinite((i as StatCounter).value),
  );

/**
 * ── THE OVERRIDE READERS ───────────────────────────────────────────────────
 *
 * Everything below reads a block the tenant authored and hands it to a band
 * that already has copy of its own. That is the whole model, and it is worth
 * stating once rather than in four places:
 *
 *   the dictionary is the DEFAULT, the page is the OVERRIDE.
 *
 * A band renders `site.hero.*` from `i18n-dict.ts` until a tenant publishes a
 * home page carrying a `hero` block, at which point the block wins outright.
 * Not a merge — a tenant must never see a headline half theirs and half ours.
 *
 * This is what closes the gap the whole website editor fell into: the words on
 * the homepage were real, visible, and written into a frontend bundle where no
 * tenant could reach them. Seed 9086 puts the same words into blocks, so the
 * first thing a tenant sees in the editor is the page they already have.
 *
 * Every reader answers null when the block is absent, which is the normal state
 * and the one the fallbacks are for.
 */

/** A link as the block schema stores it: a label plus an internal path or a
 *  mailto/tel/https URL. Relative paths resolve against the site base, so a
 *  link keeps working when the tenant moves off /public onto their own domain. */
export type BlockLink = { label: Bilingual; href: string } | null;

export type HeroBlock = {
  kicker: Bilingual | null;
  title: Bilingual;
  lead: Bilingual | null;
  cta: BlockLink;
};

export type FeatureItem = { title: Bilingual; text: Bilingual | null };

export type FeatureListBlock = {
  title: Bilingual | null;
  items: FeatureItem[];
};

export type CtaBandBlock = {
  title: Bilingual;
  text: Bilingual | null;
  cta: BlockLink;
};

const blockOf = (page: SitePage | null, type: string): Record<string, unknown> | null => {
  const block = (page?.blocks || []).find((b) => b.type === type);
  return block ? (block.content as Record<string, unknown>) : null;
};

/** A bilingual field, or null when the block omitted it. `bi()` in the block
 *  schema requires FR and allows EN to be absent, so this only has to prove the
 *  shape, never that both halves are present — `pickBilingual` handles that. */
const bilingual = (v: unknown): Bilingual | null =>
  v && typeof v === "object" && typeof (v as Bilingual).fr === "string"
    ? (v as Bilingual)
    : null;

const linkOf = (v: unknown): BlockLink => {
  if (!v || typeof v !== "object") return null;
  const raw = v as { label?: unknown; href?: unknown };
  const label = bilingual(raw.label);
  return label && typeof raw.href === "string" && raw.href ? { label, href: raw.href } : null;
};

/**
 * The hero, when the tenant has written one.
 *
 * `title` is required by the schema, so a block without one is malformed and
 * answers null rather than rendering a hero with no headline — which on this
 * page would be a full-bleed photograph with two buttons floating on it.
 *
 * `background_image` is deliberately NOT read here. The hero already resolves
 * its artwork from branding (`siteHeroUrl`, then the login backdrop), and a
 * third source competing with those two would mean a tenant who uploads in
 * Settings › Branding sees nothing change. One image, one place to set it.
 */
export function heroBlock(page: SitePage | null): HeroBlock | null {
  const c = blockOf(page, "hero");
  const title = bilingual(c?.title);
  if (!title) return null;
  return {
    kicker: bilingual(c?.kicker),
    title,
    lead: bilingual(c?.lead),
    cta: linkOf(c?.cta),
  };
}

/** The how-it-works list, from the first `feature_list` block. Items without a
 *  title are dropped rather than rendered as an empty step. */
export function featureList(page: SitePage | null): FeatureListBlock | null {
  const c = blockOf(page, "feature_list");
  if (!c) return null;
  const raw = Array.isArray(c.items) ? c.items : [];
  const items = raw
    .map((i) => {
      const row = i as { title?: unknown; text?: unknown };
      const title = bilingual(row.title);
      return title ? { title, text: bilingual(row.text) } : null;
    })
    .filter((i): i is FeatureItem => i !== null);
  return items.length ? { title: bilingual(c.title), items } : null;
}

/** The closing call to action, from the first `cta_band` block. */
export function ctaBand(page: SitePage | null): CtaBandBlock | null {
  const c = blockOf(page, "cta_band");
  const title = bilingual(c?.title);
  if (!title) return null;
  return { title, text: bilingual(c?.text), cta: linkOf(c?.cta) };
}

/** The credentials row, from the first `stat_chips` block. */
export const statChips = (page: SitePage | null): StatChip[] =>
  itemsOf(page, "stat_chips").filter(
    (i): i is StatChip => !!i && typeof i === "object",
  );

/* ── the group story (§6.9's `/public/site/about`) ─────────────────────────
 *
 * PR 5 (§9.1) renders the whole of this as the About page. PR 4 needs one field
 * from it: `esg`, which §8.4 turns into the programme's worked example of the
 * 90-word rule.
 *
 * THREE FIXED PILLARS, NOT AN OPEN BAG. `packages/shared/schemas/site-settings.js`
 * says why in as many words: the renderer builds a three-panel interactive and
 * can only do that if it knows there are exactly three and what they are
 * called. An open record would mean the renderer guessing at whatever an editor
 * typed, and a fourth pillar silently breaking the layout.
 *
 * The pillar NAMES are ours and come from the dictionary — Environment, Social,
 * Governance are the standard triad, not a claim about this tenant. Everything
 * inside a pillar is theirs.
 */
export type EsgPillar = {
  text: string;
  points: string[];
};

export type EsgContent = {
  environment: EsgPillar | null;
  social: EsgPillar | null;
  governance: EsgPillar | null;
};

type RawPillar = {
  text_fr?: unknown;
  text_en?: unknown;
  points?: unknown;
};

/** One pillar, read in the visitor's language. Null when the tenant has not
 *  written it — which is the default, and the band draws nothing rather than a
 *  heading over an empty column. */
function pillar(raw: unknown, lang: Lang): EsgPillar | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawPillar;
  const text = pickBilingual(
    { fr: String(r.text_fr ?? ""), en: r.text_en == null ? null : String(r.text_en) },
    lang,
  );
  const points = (Array.isArray(r.points) ? r.points : [])
    .map((pt) => pickBilingual(pt as Bilingual, lang))
    .filter((t): t is string => !!t);
  // A pillar with neither prose nor a single point is not a pillar. Rendering
  // its heading anyway would put "Environment" over white space on a public
  // page, which is worse than the section being one column shorter.
  return text || points.length ? { text, points } : null;
}

export const getPublicEsg = (opts: { lang: Lang; signal?: AbortSignal }) =>
  publicGet<{ esg?: unknown }>("/public/site/about", { signal: opts.signal })
    .then(
      (about): EsgContent => ({
        environment: pillar((about?.esg as Record<string, unknown>)?.environment, opts.lang),
        social: pillar((about?.esg as Record<string, unknown>)?.social, opts.lang),
        governance: pillar((about?.esg as Record<string, unknown>)?.governance, opts.lang),
      }),
    )
    /* Every failure is the same answer, for the reason `getSitePage` states: an
       unpublished story, a tenant without the `website` package and a network
       error are three facts server-side and one fact here — there is nothing to
       draw. The band renders nothing in all three. */
    .catch((): EsgContent => ({ environment: null, social: null, governance: null }));

/** Whether any pillar has content. The band mounts nothing at all otherwise —
 *  no heading, no empty columns, no "coming soon".
 *
 *  A TYPE GUARD rather than a boolean, so the null check and the render site
 *  cannot drift. Guarding with a plain boolean would leave the call site
 *  needing a non-null assertion — and an assertion is what survives the day
 *  somebody makes this read optional, silently, with a crash behind it. */
export const hasEsg = (esg: EsgContent | null): esg is EsgContent =>
  !!esg && !!(esg.environment || esg.social || esg.governance);

/* ── public-enabled entities (§6.9) ────────────────────────────────────────
 *
 * PR 5 (§9.2) renders these as a network in their own right. PR 3 needs one
 * field from them: `coverage`, which is the list of countries each entity
 * actually operates in.
 *
 * WHY THE SET PIECE READS IT. §7.5 says the scene's data comes from
 * `listCorridors` AND this endpoint, and the two answer different questions: a
 * corridor is a lane the tenant has RUN, an entity's coverage is ground the
 * tenant STANDS ON. A network drawing that cannot tell "we deliver here" from
 * "we are here" is missing the distinction a visitor most wants.
 *
 * The join is on `country_code` and nothing else — an exact code-to-code match,
 * both sides of it authored by the tenant. Matching an entity's ADDRESS against
 * a corridor's place NAME was the other option and it is inference: "Douala"
 * against "Douala, Littoral, Cameroun" works until the first tenant who writes
 * it differently, and a marketing page that quietly mislabels where a company
 * is, is exactly what N12 exists to prevent.
 */
export type PublicEntity = {
  id: string;
  code: string | null;
  legal_name: string;
  trading_name: string | null;
  country_code: string | null;
  /** `[{country_code, label_fr, label_en}]` — migration 13787.
   *
   *  The LABELS are read now as well as the codes (§8.5's coverage figure).
   *  They are the tenant's own words for the place, which is the only naming
   *  this app is entitled to print: a two-letter code resolved against a
   *  country table would be OUR name for their market, and the schema requires
   *  both languages precisely so it does not have to be. */
  coverage: Array<{
    country_code?: string | null;
    label_fr?: string | null;
    label_en?: string | null;
  }>;
};

/** One place a tenant says they cover, named as they named it. Rows without a
 *  label in either language are dropped rather than falling back to the code —
 *  "CM" on a public page is not a place name. */
export function coverageLabels(
  entity: PublicEntity,
  lang: Lang,
): string[] {
  const seen = new Set<string>();
  for (const c of entity.coverage || []) {
    const label = pickBilingual(
      {
        fr: String(c.label_fr ?? ""),
        en: c.label_en == null ? null : String(c.label_en),
      },
      lang,
    );
    if (label) seen.add(label);
  }
  return [...seen];
}

export const listPublicEntities = (opts: { signal?: AbortSignal } = {}) =>
  publicGet<PublicEntity[]>("/public/site/entities", { signal: opts.signal });

/**
 * Every ISO country code the tenant's public entities sit in or cover, upper-cased.
 *
 * Empty for a tenant with no public entity — which is the default, since
 * `public_enabled` is off until somebody turns it on deliberately (13787). The
 * scene then marks nothing, which is correct: no claim is made from an absence.
 */
export function coveredCountries(entities: PublicEntity[] | null): Set<string> {
  const out = new Set<string>();
  for (const e of entities || []) {
    if (e.country_code) out.add(e.country_code.toUpperCase());
    for (const c of e.coverage || []) {
      if (c && c.country_code) out.add(String(c.country_code).toUpperCase());
    }
  }
  return out;
}

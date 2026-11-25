import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { messageFor, requestIdFor } from "@/lib/api";
import {
  coverUrl,
  insightExcerpt,
  insightSlug,
  insightTitle,
  listInsights,
  type InsightCard,
  type InsightIndex,
  type InsightKind,
} from "@/lib/insights-api";
import { getLang, tStatic } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";
import { useShareMeta } from "@/lib/use-share-meta";
import { StagedLines } from "@/components/ui/type";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { IconTile } from "@/components/ui/icon-tile";
import { BgMap } from "@/components/ui/bg-map";
import { Reveal } from "@/components/ui/reveal";
import { DocumentIcon } from "@/components/ui/icons";
import { Byline, ReadingTime } from "./insight-parts";
import { PageHero } from "@/components/site/page-hero";

/**
 * `/public/insights` — the tenant's own writing.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * smartls.cm's "Kaizen Hub", renamed per the resolved decision. Five faults,
 * fixed here rather than reproduced:
 *
 *   1. **Their filter bar hides articles.** Four hardcoded buttons over six tags
 *      in the data: two articles cannot be reached by ANY filter. The bar below
 *      is whatever `tags` the server sends, derived from the tags in use, so the
 *      bug is not expressible here.
 *   2. **No dates anywhere.** Every card is dated, and the article page sends
 *      `article:published_time`.
 *   3. **No excerpt** — their cards carry title and author only.
 *   4. **Search is title-only, client-side, over hardcoded DOM.** Fine at five
 *      articles, useless at thirty. There is no search here yet; the tag filter
 *      is server-side and paginated, which is the half that scales. A real
 *      search belongs in the API once there is enough to search.
 *   5. **Author names inside translation keys.** Names are not translatable
 *      content; ours come from the staff record.
 *
 * ── THE FILTER IS A URL, NOT STATE ─────────────────────────────────────────
 *
 * `?tag=` and `?page=`, for the reason the tracking page gives about `?ref=`: a
 * filtered view somebody wants to send is a filtered view that has to have an
 * address. It also makes the Back button walk the filters, which is what a
 * reader expects after clicking three of them.
 */
export function InsightsPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") || "";
  /* §8.6's kind filter, in the URL for the same reason `tag` is: a filtered
     view somebody wants to send has to have an address. Anything that is not
     one of the two kinds is read as "both" rather than passed to the server —
     the endpoint would reject it with a 400, and a hand-edited URL should
     degrade to the unfiltered page, not to an error screen. */
  const kindParam = params.get("kind") || "";
  const kind: InsightKind | "" =
    kindParam === "article" || kindParam === "announcement" ? kindParam : "";
  /* 14680, the year archive. In the URL for the reason `tag` is. A value that
     is not a plausible year is read as "every year" rather than sent on. */
  const yearParam = Number(params.get("year") || "");
  const year = Number.isInteger(yearParam) && yearParam >= 1990 && yearParam <= 2100 ? yearParam : 0;
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; view: InsightIndex }
    | { kind: "error"; message: string; requestId: string | null }
  >({ kind: "loading" });

  useShareMeta("insights");

  React.useEffect(() => {
    const ctl = new AbortController();
    setState({ kind: "loading" });
    listInsights({ tag: tag || undefined, kind, year: year || undefined, page, signal: ctl.signal })
      .then((view) => setState({ kind: "ready", view }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({
          kind: "error",
          message: messageFor(e, tStatic("errors.loadFailed")),
          requestId: requestIdFor(e),
        });
      });
    return () => ctl.abort();
  }, [tag, kind, year, page, nonce]);

  /** Changing a filter always returns to page one — page 4 of "strategy" is
   *  usually not a page at all, and an empty result there reads as "no
   *  articles" rather than "no fourth page". */
  const choose = (next: string) => {
    const q = new URLSearchParams();
    if (next) q.set("tag", next);
    // The kind SURVIVES a tag change, and vice versa. They are two questions —
    // "what sort of post" and "about what" — and a filter bar that silently
    // clears the other one every time is a filter bar people stop trusting.
    if (kind) q.set("kind", kind);
    if (year) q.set("year", String(year));
    setParams(q);
  };

  const chooseKind = (next: InsightKind | "") => {
    const q = new URLSearchParams();
    if (tag) q.set("tag", tag);
    if (next) q.set("kind", next);
    if (year) q.set("year", String(year));
    setParams(q);
  };

  /* The year survives the other two filters and they survive it, for the
     reason given above: three questions, none of which should clear another. */
  const chooseYear = (next: number) => {
    const q = new URLSearchParams();
    if (tag) q.set("tag", tag);
    if (kind) q.set("kind", kind);
    if (next) q.set("year", String(next));
    setParams(q);
  };

  const goToPage = (next: number) => {
    const q = new URLSearchParams();
    if (tag) q.set("tag", tag);
    if (kind) q.set("kind", kind);
    if (year) q.set("year", String(year));
    if (next > 1) q.set("page", String(next));
    setParams(q);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const showLead =
    state.kind === "ready" && page === 1 && !tag && !year && state.view.articles.length > 0;

  return (
    <PageShell overlayHeader label={t("site.insights.title")} footer>
      <PageHero slot="insights-hero" fallback={<BgMap />}>
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.insights.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            /* F-17: the LCP element on this route. */
            title={<StagedLines paintImmediately text={t("site.insights.titleMain")} />}
            accent={t("site.insights.titleAccent")}
            lead={t("site.insights.sub")}
          />

          {/*
            The filter bar lives IN the hero, which is where their Kaizen page
            puts its search and filters — and it is right for the same reason
            the wizard's step dots sit above the form: this is the page's
            primary control, and below the hero it is under the fold on a phone,
            where a reader has to scroll past three cards to discover the page
            can be filtered at all.

            Rendered only once the list has answered: a bar that appears empty
            and then fills is a layout that jumps under somebody's thumb.
          */}
          {/* §8.6's kind filter. ABOVE the tags and always present, because it
              is the coarser cut: "articles or announcements" is a different
              question from "which subject", and a reader who wants the notices
              should not have to find them among the essays. It does not wait
              for the list — unlike the tag bar, its three options are known
              before any request, so rendering it immediately costs no layout
              jump and gives the page a control on the first frame. */}
          <nav aria-label={t("site.insights.kindLabel")} className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {([
                ["", t("site.insights.kindAll")],
                ["article", t("site.insights.kindArticle")],
                ["announcement", t("site.insights.kindAnnouncement")],
              ] as Array<[InsightKind | "", string]>).map(([value, label]) => (
                <li key={value || "all"}>
                  <FilterButton
                    active={kind === value}
                    onClick={() => chooseKind(value)}
                  >
                    {label}
                  </FilterButton>
                </li>
              ))}
            </ul>
          </nav>

          {state.kind === "ready" && state.view.tags.length > 0 && (
            <nav aria-label={t("site.insights.filterLabel")} className="mt-8">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <FilterButton active={!tag} onClick={() => choose("")}>
                    {t("site.insights.all")}
                  </FilterButton>
                </li>
                {state.view.tags.map((entry) => (
                  <li key={entry.tag}>
                    <FilterButton
                      active={tag === entry.tag}
                      onClick={() => choose(entry.tag)}
                    >
                      {entry.tag}
                      <span className="num ml-1.5 text-xs opacity-70">{entry.count}</span>
                    </FilterButton>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {/* The year archive (14680). Derived from the live articles like the
              tags, so a year with nothing in it cannot appear. Drawn only when
              there is more than one year to choose between. */}
          {state.kind === "ready" && (state.view.years?.length ?? 0) > 1 && (
            <nav aria-label={t("site.insights.yearLabel")} className="mt-4">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <FilterButton active={!year} onClick={() => chooseYear(0)}>
                    {t("site.insights.allYears")}
                  </FilterButton>
                </li>
                {(state.view.years || []).map((entry) => (
                  <li key={entry.year}>
                    <FilterButton
                      active={year === entry.year}
                      onClick={() => chooseYear(entry.year)}
                    >
                      <span className="num">{entry.year}</span>
                      <span className="num ml-1.5 text-xs opacity-70">{entry.count}</span>
                    </FilterButton>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </PageContainer>
      </PageHero>

      <Section>
        {state.kind === "loading" ? (
          <LoadingState
            label={t("site.insights.loading")}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lux-card overflow-hidden">
                <Skeleton className="h-40 w-full rounded-none" />
                <div className="p-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-5 w-full" />
                  <Skeleton className="mt-2 h-4 w-4/5" />
                </div>
              </div>
            ))}
          </LoadingState>
        ) : state.kind === "error" ? (
          <ErrorState
            message={state.message}
            requestId={state.requestId}
            action={<Button onClick={() => setNonce((n) => n + 1)}>{t("common.retry")}</Button>}
          />
        ) : state.view.articles.length === 0 ? (
          <EmptyState
            title={
              tag
                ? t("site.insights.noneForTag")
                : year
                  ? t("site.insights.noneForYear")
                  : t("site.insights.none")
            }
            hint={tag || year ? t("site.insights.noneForTagHint") : t("site.insights.noneHint")}
            action={
              tag || year ? (
                <Button variant="outline" onClick={() => setParams(new URLSearchParams())}>
                  {t("site.insights.showAll")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* THE LEAD (14680). On the unfiltered first page the newest piece
                is drawn large above the grid: a library reads as current when
                its latest piece is the first thing a visitor sees, and as an
                archive when every card is the same size. Filtered views stay a
                plain grid, because there the reader is choosing, not browsing. */}
            {showLead && <LeadCard article={state.view.articles[0]} lang={lang} />}
            <ul className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", showLead && "mt-10")}>
              {(showLead ? state.view.articles.slice(1) : state.view.articles).map((a, i) => (
                <Reveal
                  as="li"
                  key={a.slug_fr || a.slug_en || insightTitle(a, lang)}
                  // Staggered by COLUMN, not by index: a three-across grid
                  // whose ninth card waits half a second is a grid the reader
                  // has finished looking at. The row resets the delay.
                  delay={(i % 3) as 0 | 1 | 2}
                >
                  <ArticleCard article={a} lang={lang} />
                </Reveal>
              ))}
            </ul>

            {(page > 1 || state.view.has_more) && (
              <nav
                aria-label={t("site.insights.pagination")}
                className="mt-10 flex items-center justify-between gap-4"
              >
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  {t("site.insights.previous")}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {t("site.insights.pageOf", {
                    page,
                    total: Math.max(1, Math.ceil(state.view.total / state.view.per_page)),
                  })}
                </p>
                <Button disabled={!state.view.has_more} onClick={() => goToPage(page + 1)}>
                  {t("site.insights.next")}
                </Button>
              </nav>
            )}
          </>
        )}
      </Section>
    </PageShell>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // `aria-pressed`, not `aria-current`: these are toggles over one list, not
      // navigation between pages, and a screen reader announces the two
      // differently.
      aria-pressed={active}
      className={cn(
        "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange))] font-semibold text-[var(--primary-foreground)]"
          // On the hero plate `--ink` is inverted, so a resting chip has to
          // borrow the band's own foreground rather than the page's.
          : "border-[rgb(237_238_238/0.25)] text-[var(--hero-muted)] hover:bg-[rgb(237_238_238/0.10)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One card: cover, date, title, excerpt, author.
 *
 * The cover renders only once it LOADS. `has_cover` says a document is attached,
 * not that the allowlist will stream it — the public media route re-checks and
 * 404s a draft's cover — and a broken frame on a marketing page is worse than a
 * card with no image. The same rule `portfolio-api` states: never render media
 * this app did not get a URL for.
 */
function ArticleCard({ article, lang }: { article: InsightCard; lang: string }) {
  const [coverOk, setCoverOk] = React.useState(true);
  const slug = insightSlug(article, lang);
  const title = insightTitle(article, lang);
  const excerpt = insightExcerpt(article, lang);
  const src = coverUrl(article.cover_id);

  const body = (
    <>
      {src && coverOk ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setCoverOk(false)}
          className="h-40 w-full object-cover"
        />
      ) : (
        /* Not every article has a cover, and one that does not must not read as
           a broken card beside three illustrated ones. A tinted plate with the
           section's own glyph is an honest placeholder — it says "an article",
           which is true, rather than standing in for a photograph nobody took. */
        <div className="flex h-40 w-full items-center justify-center bg-[rgb(var(--ink)/0.04)]">
          <IconTile icon={DocumentIcon} size="lg" />
        </div>
      )}
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {article.published_at && (
            <time dateTime={article.published_at} className="num">
              {dateFmt(article.published_at)}
            </time>
          )}
          <ReadingTime minutes={article.reading_minutes} />
          {article.tags.slice(0, 2).map((tg) => (
            <Chip key={tg}>{tg}</Chip>
          ))}
        </div>
        <h2 className="mt-2 font-display text-title font-semibold leading-snug tracking-tight">
          {title}
        </h2>
        {excerpt && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{excerpt}</p>
        )}
        <Byline article={article} className="mt-4 text-xs" />
      </div>
    </>
  );

  // An article with no slug in either language has no address. It still renders
  // — the desk published it — but as a tile rather than a dead link.
  return slug ? (
    <Link
      to={p("/insights/" + encodeURIComponent(slug))}
      className="lux-card block h-full overflow-hidden transition-shadow hover:shadow-md"
    >
      {body}
    </Link>
  ) : (
    <div className="lux-card h-full overflow-hidden">{body}</div>
  );
}

/**
 * The lead article (14680): the newest piece, drawn large. Cover on the left at
 * desktop widths and on top on a phone; headline, standfirst, byline and a
 * plain "Read the article" so the whole block is one obvious target.
 */
function LeadCard({ article, lang }: { article: InsightCard; lang: string }) {
  const { t } = useTranslation();
  const [coverOk, setCoverOk] = React.useState(true);
  const slug = insightSlug(article, lang);
  const title = insightTitle(article, lang);
  const excerpt = insightExcerpt(article, lang);
  const src = coverUrl(article.cover_id);
  const body = (
    <div className="grid gap-0 md:grid-cols-2">
      {src && coverOk ? (
        <img
          src={src}
          alt=""
          onError={() => setCoverOk(false)}
          className="h-56 w-full object-cover md:h-full"
        />
      ) : (
        <div className="flex h-56 w-full items-center justify-center bg-[rgb(var(--ink)/0.04)] md:h-full">
          <IconTile icon={DocumentIcon} size="lg" />
        </div>
      )}
      <div className="p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-ink">
          {t("site.insights.lead")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {article.published_at && (
            <time dateTime={article.published_at} className="num">
              {dateFmt(article.published_at)}
            </time>
          )}
          <ReadingTime minutes={article.reading_minutes} />
        </div>
        <h2 className="mt-3 font-display text-h2 font-semibold leading-tight tracking-tight">
          {title}
        </h2>
        {excerpt && <p className="mt-3 text-muted-foreground">{excerpt}</p>}
        <Byline article={article} className="mt-5 text-sm" />
        {slug && (
          <p className="mt-6 text-sm font-semibold text-primary-ink">
            {t("site.insights.readArticle")}
          </p>
        )}
      </div>
    </div>
  );
  return slug ? (
    <Link
      to={p("/insights/" + encodeURIComponent(slug))}
      className="lux-card block overflow-hidden transition-shadow hover:shadow-md"
    >
      {body}
    </Link>
  ) : (
    <div className="lux-card overflow-hidden">{body}</div>
  );
}

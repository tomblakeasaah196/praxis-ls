import * as React from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApproaching } from "@/components/ui/reveal";
import type { ServiceCard } from "@/lib/services-api";
import { tList } from "@/lib/i18n";
import "@/components/site/desktop.css";

/**
 * The quote form at the bottom of a service page, fetched a screen before it is
 * read.
 *
 * ── THE DEFECT THIS FIXES (F-18) ──────────────────────────────────────────
 *
 * `services-page.tsx` imported `QuoteWizard` statically. Rollup is right to
 * follow that: a static import from a route chunk is part of that route, so the
 * wizard's 6.6 kB gzipped landed on the critical path of every service page.
 * React cannot commit a lazy route until its whole static graph has arrived, so
 * a visitor who opened `/services/sea-freight` to read three paragraphs waited
 * for a multi-step form sitting two screens below the fold — and it was the
 * single largest item in that wait, larger than the page it was on.
 *
 * Nothing reported it, which is the actual finding. The first-paint gate
 * measured the entry and its static imports and read a comfortable green while
 * the real chain was 143.6 kB. `check-bundle.mjs` now measures per route, and
 * this component is what that measurement asked for.
 *
 * ── WHY IT IS NOT SIMPLY `React.lazy` ─────────────────────────────────────
 *
 * `React.lazy` alone starts the fetch when the element renders, which here is
 * the same moment the page renders — so the chunk leaves the critical path and
 * then races the reader anyway, and the Suspense fallback swapping for a form
 * of a different height is a layout shift under somebody's thumb. That is the
 * reflow `fonts-fallback.css` was written to prevent, arriving by another door.
 *
 * `useApproaching` gives a screen of lead: the fetch starts while the band is
 * still off screen, where a size change costs nothing (CLS scores shifts of
 * VISIBLE content), and the form is normally in place before the band is
 * legible. The placeholder below is what a reader sees only if they jump to the
 * bottom of the page faster than one request.
 *
 * ── AND WHY THE PLACEHOLDER IS NOT A FAITHFUL SKELETON ────────────────────
 *
 * It deliberately does not imitate the wizard's controls. A skeleton whose
 * height misses the content it stands in for is a shift with extra steps —
 * `/careers` scores CLS 0.093 that way, from a four-row `PageSkeleton` standing
 * in for a list of a different length. The honest version reserves ONE height,
 * matching the wizard's first step, and says what is coming.
 */
const QuoteWizard = React.lazy(() =>
  import("@/components/site/quote-wizard").then((m) => ({
    default: m.QuoteWizard,
  })),
);

export function QuoteBand({
  services = [],
  preselect = null,
}: {
  services?: ServiceCard[];
  preselect?: ServiceCard | null;
}) {
  const { t } = useTranslation();
  const [ref, near] = useApproaching<HTMLDivElement>();

  return (
    // From 1280px the card has the next steps beside it (`.quote-band` in
    // desktop.css); below that the steps are not drawn and the band is the
    // card alone, as it always was.
    <div ref={ref} className="quote-band">
      <Card padded className="max-w-reading">
        {near ? (
          <React.Suspense fallback={<QuotePlaceholder label={t("common.loading")} />}>
            {/* The list AND the row this page is about.

                This band used to render `<QuoteWizard />` bare, so a visitor who
                had just read the whole of the sea-freight page was asked, on that
                same page, how their cargo was moving and which service they
                wanted — with no options to choose from, because the wizard had
                never been handed the published list. It asked for the one thing
                the page already knew, in a free-text box.

                `services` is the module-cached read the page already holds, so
                neither prop costs a request. */}
            <QuoteWizard services={services} preselect={preselect} />
          </React.Suspense>
        ) : (
          <QuotePlaceholder label={t("common.loading")} />
        )}
      </Card>
      <QuoteSteps className="quote-band-steps hidden" />
    </div>
  );
}

/**
 * One reserved box, at the height of the wizard's first step.
 *
 * `role="status"` rather than a bare div: a screen-reader user who has just
 * tabbed to the end of the page is told the form is arriving instead of
 * meeting an unlabelled gap.
 */
function QuotePlaceholder({ label }: { label: string }) {
  return (
    <div className="min-h-[19rem] space-y-4" role="status" aria-label={label}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * "What happens next" beside the wizard, drawn from 1280px only (the element
 * also carries `hidden`; `.quote-band-steps` in desktop.css shows it).
 *
 * The same three steps and markup as the aside on the quote page
 * (`features/quote/quote-page.tsx`). Kept as a copy on purpose: shared, it
 * became its own chunk on two routes and cost more than the twenty lines it
 * saves, against budgets (`check:bundle`) with almost no headroom.
 */
function QuoteSteps({ className }: { className?: string }) {
  const { t } = useTranslation();
  const steps = tList<{ t: string; d: string }>("site.quote.steps");
  return (
    <div className={className}>
      <h2 className="text-title font-semibold tracking-tight">
        {t("site.quote.whatHappens")}
      </h2>
      <ol className="mt-5 space-y-5">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-3.5">
            <span
              aria-hidden
              className="num mt-0.5 text-micro font-semibold text-[var(--primary-ink)]"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-sm font-semibold">{s.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-muted-foreground">
        {t("site.quote.requiredNote")}
      </p>
    </div>
  );
}

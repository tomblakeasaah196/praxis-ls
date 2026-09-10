import * as React from "react";
import { cn } from "@/lib/cn";
import { useScrollScrub } from "@/lib/motion";
import { useRevealed } from "@/components/ui/reveal";

/**
 * Type as a material.
 *
 * ── WHY THESE EXIST ────────────────────────────────────────────────────────
 *
 * The brief for this programme is explicit that long static prose is the enemy:
 * readers fatigue and leave, and a wall of text is what makes a considered site
 * read as a brochure. `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` §1.5 turns that into
 * a number — no prose block on a marketing page exceeds 90 words without being
 * broken by an illustration, a diagram, a pull-quote or a staged reveal.
 *
 * A rule with a number needs tools, or every author meets it by deleting
 * sentences. These are the tools: ways to make text itself carry motion,
 * emphasis and structure, so the 90 words that survive do more work than the
 * 300 they replaced.
 *
 * ── AND WHY THEY ARE CAREFUL ABOUT SCREEN READERS ──────────────────────────
 *
 * Every technique here fragments a sentence into elements. That is fine for
 * sighted readers and a genuine hazard for assistive technology, which can
 * announce a word-split heading one word at a time. So `StagedLines` hides every
 * fragment and carries the whole sentence in a visually-hidden span — the
 * heading is announced as one sentence, and what is animated is decoration the
 * screen reader never sees.
 *
 * ── WHY THAT IS A HIDDEN SPAN AND NOT `aria-label` ────────────────────────
 *
 * It was `aria-label` on the container, which is the obvious solution and is
 * INVALID: ARIA prohibits `aria-label` on a generic element — a `<span>` or a
 * `<div>` with no role — because there is no role for the label to name. Chrome
 * and axe both report it (`aria-prohibited-attr`), and the practical effect is
 * that some assistive technology ignores the label entirely and announces the
 * heading as empty, since every fragment inside it is `aria-hidden`.
 *
 * Found by running Lighthouse against the built homepage rather than by
 * reading the component: PR 1 shipped this primitive and nothing rendered it
 * until PR 3 put it on the hero, so the defect had never been on a page.
 */

/**
 * A heading that arrives a word at a time.
 *
 * Splitting happens at render, never on a timer: a `setInterval` that reveals
 * words is a component that keeps running after the reader has looked away,
 * and it desynchronises the moment the tab is backgrounded. Here the stagger is
 * pure CSS — each fragment carries its index as `--i` and reads a delay from
 * it — so the browser owns the schedule and pausing is free.
 *
 * Under reduced motion, and when `IntersectionObserver` is missing, the settled
 * state renders immediately. That is the rule `reveal.tsx` set and it is not a
 * shorter animation.
 */
export function StagedLines({
  text,
  as: Tag = "span",
  className,
  wordClassName,
  /** Milliseconds between consecutive words. Kept small — the whole phrase must
   *  land inside the 600 ms narrative budget however many words it has, so the
   *  total is capped below rather than multiplied out. */
  step = 45,
  /**
   * Paint the words at full opacity from the first frame, staggering only their
   * RISE. Set this on anything that is the page's LCP element.
   *
   * ── WHY IT EXISTS, WITH THE NUMBER ────────────────────────────────────
   *
   * `.staged-word` starts at `opacity: 0`. Largest Contentful Paint measures
   * when the largest element is PAINTED, and text at zero opacity is not
   * painted — so a headline that fades in delays LCP by the whole of its own
   * entrance. On the hero, which §7.1 names as the LCP element, that measured:
   *
   *     element render delay  2989 ms → 3679 ms   (+691 ms)
   *
   * against `main`, for an animation nobody asked to wait for. Worse, the
   * reveal is triggered by `useRevealed` — an IntersectionObserver — and the
   * hero is ALWAYS in view at load, so the "scroll reveal" fires immediately
   * and buys nothing at all in exchange for that delay.
   *
   * Staggering the transform alone keeps the effect: the words still arrive one
   * after another, rising into place. They are simply legible while they do it,
   * which is what a headline is for.
   */
  paintImmediately = false,
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  wordClassName?: string;
  step?: number;
  paintImmediately?: boolean;
}) {
  const [ref, shown] = useRevealed<HTMLElement>();
  const words = React.useMemo(() => text.split(/(\s+)/), [text]);

  // The stagger is capped so a long headline still completes inside the
  // narrative budget. Without this, a twelve-word line at 45ms takes 540ms of
  // stagger PLUS the word's own transition and blows the ceiling that
  // check-motion.mjs enforces.
  const realStep = Math.min(step, 420 / Math.max(words.length, 1));

  return (
    <Tag ref={ref as React.Ref<never>} className={cn("staged", className)}>
      {/* The real, readable sentence. Present in the DOM, in the accessibility
          tree, and clipped to a single pixel — so the heading's accessible name
          comes from actual text content, which needs no role and no ARIA at
          all. `sr-only` is Tailwind's own recipe and is already used elsewhere
          in this app. */}
      <span className="sr-only">{text}</span>
      {words.map((word, i) =>
        /^\s+$/.test(word) ? (
          // Whitespace is preserved as text rather than as a fragment: wrapping
          // it makes `inline-block` collapse the gap and the words run together.
          <React.Fragment key={i}>{word}</React.Fragment>
        ) : (
          <span
            key={i}
            aria-hidden
            className={cn(
              "staged-word",
              paintImmediately && "staged-word-lit",
              shown && "is-in",
              wordClassName,
            )}
            style={{ transitionDelay: shown ? `${Math.round((i / 2) * realStep)}ms` : undefined }}
          >
            {word}
          </span>
        ),
      )}
    </Tag>
  );
}

/**
 * Display type whose WEIGHT responds to scroll position.
 *
 * This is the one effect that genuinely needs a variable font with a wide axis,
 * and the reason Archivo is in the library (100–900). It is deliberately subtle:
 * a headline that swings from Thin to Black as you scroll is a novelty, and a
 * headline that gains thirty or forty units of weight as it settles into place
 * reads as the page focusing.
 *
 * `--scrub` comes from `useScrollScrub`, which writes it on the element without
 * touching React. Under reduced motion the hook sets it once to its settled
 * value and attaches nothing.
 */
export function WeightScrub({
  children,
  from = 380,
  to = 680,
  as: Tag = "span",
  className,
}: {
  children: React.ReactNode;
  from?: number;
  to?: number;
  as?: "h1" | "h2" | "h3" | "span" | "div";
  className?: string;
}) {
  const ref = useScrollScrub<HTMLElement>({ start: 0.9, end: 0.35, prop: "--scrub" });
  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn("weight-scrub", className)}
      style={
        {
          "--wght-from": String(from),
          "--wght-to": String(to),
        } as React.CSSProperties
      }
    >
      {children}
    </Tag>
  );
}

/**
 * A sentence lifted out of the flow.
 *
 * The cheapest way to break a wall of prose and the one most often done badly:
 * a pull-quote that merely enlarges the text adds length without adding
 * structure. This one changes the MEASURE as well as the size, so the eye
 * registers a different kind of object rather than the same object shouting.
 *
 * `cite` is optional and, when present, is real attribution — `<figcaption>`
 * inside a `<figure>`, so it is announced as belonging to the quote rather than
 * as a stray line of small text.
 */
export function PullQuote({
  children,
  cite,
  className,
}: {
  children: React.ReactNode;
  cite?: string;
  className?: string;
}) {
  return (
    <figure className={cn("pull-quote", className)}>
      <blockquote>{children}</blockquote>
      {cite ? <figcaption>{cite}</figcaption> : null}
    </figure>
  );
}

/**
 * A figure with a label — the unit that replaces a sentence containing a
 * number.
 *
 * "We have been operating since 2021" is a sentence a reader skims. 2021, set
 * large, in the mono face, with "operating since" beneath it, is a fact they
 * retain. `tabular-nums` because these sit in rows and a proportional 1 makes
 * a row of figures look broken.
 *
 * It asserts nothing on its own: the value comes from the caller, which comes
 * from the tenant's own data. N12 is not relaxed by making a number look good.
 */
export function FigureCallout({
  value,
  label,
  sublabel,
  className,
}: {
  value: React.ReactNode;
  label: string;
  sublabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("figure-callout", className)}>
      <div className="figure-callout-value">{value}</div>
      <div className="figure-callout-label">{label}</div>
      {sublabel ? (
        <div className="figure-callout-sub">{sublabel}</div>
      ) : null}
    </div>
  );
}

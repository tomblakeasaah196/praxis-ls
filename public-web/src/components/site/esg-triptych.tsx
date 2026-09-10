import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useScrollScrub } from "@/lib/motion";
import type { EsgPillar } from "@/lib/site-api";

/**
 * The ESG interactive — guide §8.4, and the programme's worked example of §1.5.
 *
 * ── THE PROBLEM IT EXISTS TO SOLVE ─────────────────────────────────────────
 *
 * The supplied ESG copy is three columns of bullets: fourteen short lines under
 * three headings. It is the single most text-heavy block in the programme and
 * the one Q12 named specifically. §1.5's rule — "every list of three or more
 * parallel items is a candidate for a diagram, not a `<ul>`" — is not satisfied
 * by setting that in a nicer typeface.
 *
 * So each pillar is a DRAWING that assembles as it enters, and its points are
 * ANNOTATIONS ON that drawing: a leader line from a marked place in the
 * illustration to the sentence about it. The claim and the picture of the claim
 * are the same object, which is the whole difference between a diagram and a
 * list with an image above it.
 *
 * ── WHY IT IS A GRID AND NOT A HORIZONTAL SCROLL HIJACK ────────────────────
 *
 * "Scroll-scrubbed triptych" could mean the three panels move sideways as the
 * page scrolls. That was considered and rejected on two grounds, and the second
 * one is decisive:
 *
 *   · A scroll hijack has no keyboard equivalent. §1.2 rule 3 binds without
 *     exception — every narrative set piece is reachable, operable and escapable
 *     without a pointer — and a band whose content is only reachable by scroll
 *     wheel fails that on its own.
 *   · It makes reduced motion a DIFFERENT LAYOUT. §8.4 asks for the settled
 *     state to be "genuinely good ... it is what a meaningful share of readers
 *     will see", and a component with two layouts has one that is designed and
 *     one that is the fallback. Nobody maintains the fallback.
 *
 * The triptych is therefore three columns at every width and in every motion
 * preference. What the scrub drives is the ASSEMBLY of each drawing — the paths
 * draw themselves, the annotations arrive in order — so the reduced-motion
 * state is the same composition with `--scrub: 1`: fully drawn, every
 * annotation present, nothing missing and nothing to catch up on.
 *
 * `useScrollScrub` already does exactly that: under `prefers-reduced-motion` it
 * writes `settled` (1) once and attaches no listener. (§5.4's table says the
 * hook "returns a static 0"; the implementation is better than the spec and the
 * spec is what is out of date.)
 *
 * ── ONE CONCESSION, AT PHONE WIDTH ─────────────────────────────────────────
 *
 * Annotations anchored to a drawing need room for the leader line and the
 * sentence. Below 768px there is none, and a 360px screen would get overlapping
 * labels — which is not "annotations on a drawing", it is an unreadable
 * drawing. So below `md` the drawing settles above and the points render as a
 * list beneath it. The drawing is still the tenant's picture of their own
 * commitment; it simply stops carrying the labels. Recorded as a deviation.
 */

/** Where a pillar's points attach to its drawing, in the SVG's own coordinates.
 *  `side` decides which way the leader line and the label run. */
type Anchor = { x: number; y: number; side: "left" | "right" };

/**
 * THE THREE DRAWINGS.
 *
 * Hand-written inline SVG, not an asset and not a library. Three reasons, in
 * order of weight: §4.1 says this repository contains zero image files and
 * media arrives by upload rather than by commit; an illustration that IS the
 * data cannot be a static file anyway, because the annotations come from the
 * tenant's own rows; and inline SVG costs no request, no chunk and no layout
 * shift, which is what keeps this band off the deferred budget entirely.
 *
 * Each drawing is built from paths whose `stroke-dashoffset` is driven by
 * `--scrub`, so the line draws itself as the reader arrives. `pathLength="1"`
 * normalises every path to one unit regardless of its real geometry — without
 * it the dash arithmetic would need each path's measured length, which is a
 * layout read per path per frame.
 */
const VIEWBOX = "0 0 300 220";

/** Environment — a route being straightened, which is what route optimisation
 *  IS. The meander is drawn first and fades as the direct line completes. */
function EnvironmentDrawing() {
  return (
    <>
      <path
        className="esg-ghost"
        pathLength="1"
        d="M28 178 C 78 178, 66 120, 108 118 C 150 116, 138 62, 186 60 C 226 58, 240 46, 272 44"
      />
      <path
        className="esg-line"
        pathLength="1"
        d="M28 178 C 110 168, 190 96, 272 44"
      />
      {/* The load, riding the optimised line. */}
      <rect className="esg-mark" x="140" y="100" width="20" height="14" rx="2" />
      <circle className="esg-node" cx="28" cy="178" r="5" />
      <circle className="esg-node" cx="272" cy="44" r="5" />
      {/* Emissions, drawn as a diminishing series rather than as a number —
          there is no figure behind this and N12 forbids inventing one. */}
      <circle className="esg-dot" cx="70" cy="150" r="4" />
      <circle className="esg-dot" cx="112" cy="128" r="3" />
      <circle className="esg-dot" cx="154" cy="104" r="2" />
    </>
  );
}

/** Social — people around the operation, not a stack of policies. A core with
 *  spokes out to five positions; the spokes draw outward as the reader
 *  arrives, which is the direction the claims run. */
function SocialDrawing() {
  return (
    <>
      <circle className="esg-core" cx="150" cy="110" r="26" />
      {[
        [60, 54],
        [244, 54],
        [40, 152],
        [260, 152],
        [150, 190],
      ].map(([x, y], i) => (
        <g key={i}>
          <path
            className="esg-line"
            pathLength="1"
            d={`M150 110 L${x} ${y}`}
          />
          <circle className="esg-node" cx={x} cy={y} r="8" />
        </g>
      ))}
      <circle className="esg-mark" cx="150" cy="110" r="9" />
    </>
  );
}

/** Governance — the two named committees over the operation they govern, with
 *  the accountability lines between them. This one is a structure because the
 *  claim is structural: the tenant's copy names a Strategic Planning Committee
 *  and an Operational Excellence Committee, and a diagram of a structure is a
 *  more honest rendering of that than a bullet saying it exists. */
function GovernanceDrawing() {
  return (
    <>
      <rect className="esg-plate" x="52" y="30" width="82" height="34" rx="4" />
      <rect className="esg-plate" x="166" y="30" width="82" height="34" rx="4" />
      <path className="esg-line" pathLength="1" d="M93 64 L93 104 L207 104 L207 64" />
      <path className="esg-line" pathLength="1" d="M150 104 L150 134" />
      <rect className="esg-core" x="86" y="134" width="128" height="40" rx="4" />
      {/* The controls, drawn as gates on the line rather than as ticks in a
          list — a control is a thing cargo passes through. */}
      <path className="esg-line" pathLength="1" d="M110 174 L110 196 M150 174 L150 196 M190 174 L190 196" />
      <circle className="esg-node" cx="110" cy="196" r="5" />
      <circle className="esg-node" cx="150" cy="196" r="5" />
      <circle className="esg-node" cx="190" cy="196" r="5" />
    </>
  );
}

type PillarKey = "environment" | "social" | "governance";

const DRAWINGS: Record<PillarKey, { Art: () => JSX.Element; anchors: Anchor[] }> = {
  environment: {
    Art: EnvironmentDrawing,
    anchors: [
      { x: 28, y: 178, side: "left" },
      { x: 112, y: 128, side: "left" },
      { x: 150, y: 107, side: "right" },
      { x: 272, y: 44, side: "right" },
      { x: 70, y: 150, side: "left" },
    ],
  },
  social: {
    Art: SocialDrawing,
    anchors: [
      { x: 60, y: 54, side: "left" },
      { x: 244, y: 54, side: "right" },
      { x: 40, y: 152, side: "left" },
      { x: 260, y: 152, side: "right" },
      { x: 150, y: 190, side: "right" },
    ],
  },
  governance: {
    Art: GovernanceDrawing,
    anchors: [
      { x: 93, y: 47, side: "left" },
      { x: 207, y: 47, side: "right" },
      { x: 150, y: 154, side: "right" },
      { x: 110, y: 196, side: "left" },
      { x: 190, y: 196, side: "right" },
    ],
  },
};

/** How many points a drawing can carry as annotations before the rest fall to
 *  the list below. Five is what each drawing is designed to hold — the schema
 *  allows twelve, and twelve labels on one illustration is not a diagram, it is
 *  a list drawn badly. */
const ANCHORED = 5;

function Pillar({
  which,
  label,
  pillar,
}: {
  which: PillarKey;
  label: string;
  pillar: EsgPillar;
}) {
  const { t } = useTranslation();
  const { Art, anchors } = DRAWINGS[which];
  /*
   * The scrub, narrowed so the drawing COMPLETES while the panel is still
   * comfortably on screen. The default (1 → 0) finishes as the element leaves
   * the top, which for a tall band means the reader watches it assemble and
   * never sees it whole.
   *
   * Under reduced motion this writes `--scrub: 1` once and attaches no
   * listener — the settled state, which for this component is the finished
   * composition rather than a degraded one.
   */
  const ref = useScrollScrub<HTMLDivElement>({ start: 0.9, end: 0.45 });

  const anchored = pillar.points.slice(0, ANCHORED);
  const overflow = pillar.points.slice(ANCHORED);

  return (
    <div ref={ref} className="esg-pillar">
      <h3 className="text-title font-semibold tracking-tight">{label}</h3>
      {pillar.text ? (
        <p className="mt-2 text-sm text-muted-foreground">{pillar.text}</p>
      ) : null}

      <div className="esg-stage mt-5">
        <svg
          viewBox={VIEWBOX}
          className="esg-art"
          role="img"
          /* The drawing is a rendering of the sentences beside it, so its
             accessible name says that rather than describing the picture. The
             points themselves are real text in the DOM below and are read
             normally; describing the illustration too would announce the same
             content twice. */
          aria-label={t("site.esg.figureAlt", { pillar: label })}
        >
          <Art />
          {/* The leader lines, in SVG coordinates so they stay attached to the
              drawing at any width. Drawn after the art so they sit over it. */}
          {anchored.map((_, i) => {
            const a = anchors[i];
            const toX = a.side === "left" ? 8 : 292;
            return (
              <g key={i} className="esg-leader" style={annotationStyle(i, anchored.length)}>
                <path d={`M${a.x} ${a.y} L${toX} ${a.y}`} pathLength="1" />
                <circle cx={a.x} cy={a.y} r="3.5" />
              </g>
            );
          })}
        </svg>

        {/* THE ANNOTATIONS THEMSELVES, as HTML rather than as SVG `<text>`.
            SVG text does not wrap, does not inherit the type scale and is not
            selectable in the way a sentence should be. They are positioned in
            PERCENTAGES of the stage, computed from the same anchor coordinates
            the leader lines use, so the two cannot drift apart. */}
        <ul className="esg-notes">
          {anchored.map((point, i) => {
            const a = anchors[i];
            return (
              <li
                key={point}
                className={cn("esg-note", a.side === "left" ? "esg-note-l" : "esg-note-r")}
                style={
                  {
                    ...annotationStyle(i, anchored.length),
                    top: `${(a.y / 220) * 100}%`,
                  } as React.CSSProperties
                }
              >
                {point}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Below `md` the annotations are unplaceable, and any point past the
          fifth has no anchor at any width. Both land here — as real text, in
          document order, always present for a screen reader. */}
      <ul className="esg-list">
        {anchored.map((point) => (
          <li key={point}>{point}</li>
        ))}
        {overflow.map((point) => (
          <li key={point} className="esg-list-extra">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * When one annotation arrives, as a fraction of the panel's scrub.
 *
 * Spread across the back half of the travel (0.35 → 0.9) so the drawing has
 * substantially assembled before the first label appears — a label pointing at
 * a line that is not there yet reads as a mistake. `--at` is compared against
 * `--scrub` in CSS rather than in JS, which is what keeps this off the main
 * thread: the scrub writes one property per frame and the browser recomputes
 * the rest.
 */
function annotationStyle(index: number, total: number): React.CSSProperties {
  const at = 0.35 + (0.55 * index) / Math.max(total - 1, 1);
  return { "--at": at.toFixed(3) } as React.CSSProperties;
}

/**
 * The band. Renders nothing at all when the tenant has written no ESG — no
 * heading, no empty columns, no "coming soon", which is the same rule the
 * figures strip follows and for the same reason (N12).
 */
export function EsgTriptych({
  esg,
}: {
  esg: {
    environment: EsgPillar | null;
    social: EsgPillar | null;
    governance: EsgPillar | null;
  };
}) {
  const { t } = useTranslation();
  const pillars: Array<[PillarKey, EsgPillar]> = (
    ["environment", "social", "governance"] as const
  )
    .map((k) => [k, esg[k]] as [PillarKey, EsgPillar | null])
    .filter((entry): entry is [PillarKey, EsgPillar] => entry[1] !== null);

  if (!pillars.length) return null;

  return (
    <div className="esg-grid">
      {pillars.map(([key, pillar]) => (
        <Pillar
          key={key}
          which={key}
          label={t(`site.esg.${key}`)}
          pillar={pillar}
        />
      ))}
    </div>
  );
}

import * as React from "react";
import { useTranslation } from "react-i18next";
import { SocialRow } from "./social-row";
import "./footer-extras.css";
import {
  getPublicProof,
  listPublicEntities,
  type PublicCredential,
  type PublicEntity,
} from "@/lib/site-api";
import { afterPaint } from "@/lib/after-paint";
import { Link } from "react-router-dom";
import { listPublicDocuments, type PublicDocumentCard } from "@/lib/brand-api";
import { getLang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
// The heading is the Trust page's own "Policies", from its chunk-local
// dictionary, so the footer adds no key to the first-paint bundle.
import "@/features/trust/trust-i18n";

/**
 * Everything §9.5 adds to the footer, in its own chunk.
 *
 * ── WHY THIS IS A SEPARATE FILE ───────────────────────────────────────────
 *
 * `site-footer.tsx` is in the entry chunk — every route renders it — so
 * anything it statically imports is downloaded before the hero paints. This
 * module carries two network readers and, through `social-row.tsx`, seven glyph
 * paths. Written inline, they took first paint from 123.4 kB to 129.4 kB
 * against a 128 kB budget.
 *
 * Nothing is lost by moving them: both reads were already behind `after-paint`,
 * both blocks are below the fold on every route, and neither can render
 * anything before its answer arrives. The chunk is fetched at the moment the
 * data is. `site-footer.tsx`'s `FooterExtras` carries the loading half and the
 * reason it is a plain dynamic import rather than `React.lazy`.
 *
 * ── ONE COMPONENT, TWO READS, AND WHY THEY SIT TOGETHER ───────────────────
 *
 * They are one block of small print. Two independent readers in the footer
 * would be two requests from two effects with two cleanup paths for four lines
 * of text, and the social row would still need the same chunk.
 *
 * Both reads are on endpoints the About page also uses, so on `/about` this is
 * a second render of an answer the browser has already cached, and everywhere
 * else it is two small requests below the fold.
 *
 * ── THE CREDENTIALS LINE ──────────────────────────────────────────────────
 *
 * The NAMES only. The About page carries the dated strip with issuers and
 * reference numbers; a footer has room for what the tenant holds, and a reader
 * who wants the number follows the link to the page that has it.
 *
 * EXPIRY IS ALREADY APPLIED. `publicPartners` filters on `expires_on` in the
 * read, where it cannot be forgotten, so a lapsed licence leaves the footer at
 * the same moment it leaves the page — which is the whole reason that filter is
 * not in a renderer.
 *
 * ── THE LEGAL ENTITY LINE, AND WHAT IT CANNOT SAY ─────────────────────────
 *
 * A legal entity line conventionally carries a registration number — "SARL au
 * capital de X, RCCM …". This one carries the LEGAL NAMES of the companies the
 * tenant has published, and nothing else, because `GET /public/site/entities`
 * deliberately publishes no statutory identifier (13787, §6.8): a trade-register
 * number changes no visitor's decision and is most of what somebody needs to
 * impersonate a company to its own suppliers. Printing one we do not have would
 * be inventing it (N12).
 *
 * The legal name is the point of the line even so: the footer's brand name is
 * the tenant's TRADING name, and "who am I actually contracting with" is a
 * question a procurement officer asks of a freight forwarder specifically.
 *
 * Each part renders nothing when empty, which is the default for a new tenant:
 * `site_credential` is empty until somebody fills it (O-4 records that none has
 * been supplied for the tenant this was built for), and `public_enabled` is off
 * until somebody turns it on (13787).
 */
export function FooterExtrasContent() {
  const { t } = useTranslation();
  const [credentials, setCredentials] = React.useState<PublicCredential[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      const signal = controller.signal;
      getPublicProof({ signal }).then((proof) => {
        if (alive) setCredentials(proof.credentials);
      });
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, []);

  return (
    <div className="footer-extras">
      {credentials.length ? (
        <p>
          <span className="footer-extras-label">{t("site.footer.credentials")}</span>{" "}
          {credentials.map((c) => c.name).join(" · ")}
        </p>
      ) : null}
      <SocialRow onDark />
    </div>
  );
}

/**
 * The companies behind the site, under the brand block's tagline (owner's
 * review of staging, 25 Nov 2026): each a small block, the LEGAL name on one
 * line and the registered office on the next, with the country's full name
 * (`footer_address`, composed by the server from the same row the letterhead
 * uses). De-duplicated on name and address, so a group whose companies share
 * both prints them once. The footer's brand name is the trading name; this is
 * where a procurement officer reads who they would actually contract with.
 */
export function FooterEntities() {
  const [entities, setEntities] = React.useState<PublicEntity[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    listPublicEntities({ signal: controller.signal })
      .then((rows) => {
        if (alive) setEntities(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        /* silent-catch: PRESENTATION. No public entity is the normal state
           (13787), and a footer block that is absent is the correct rendering
           of it. doc/ERROR_HANDLING.md */
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const legal = [
    ...new Map(
      entities
        .filter((e) => e.legal_name)
        .map((e) => {
          const address = e.footer_address || e.registered_address || "";
          return [`${e.legal_name}|${address}`, { name: e.legal_name, address }] as const;
        }),
    ).values(),
  ];
  if (!legal.length) return null;
  return (
    <ul className="footer-entities">
      {legal.map((l) => (
        <li key={`${l.name}|${l.address}`}>
          <span className="footer-entity-name">{l.name}</span>
          {l.address ? <span>{l.address}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The published policies, under For Clients (owner's review, 25 Nov 2026):
 * each links to its own page. Only what the Publish button has released is
 * listed, because the read returns nothing else; a tenant with none shows no
 * heading.
 */
export function FooterPolicies() {
  const { t } = useTranslation();
  const [docs, setDocs] = React.useState<PublicDocumentCard[]>([]);
  const lang = getLang();

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void listPublicDocuments({ lang, signal: controller.signal }).then((rows) => {
      if (alive) setDocs(rows.filter((d) => d.kind === "POLICY"));
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [lang]);

  if (!docs.length) return null;
  return (
    <div className="mt-8">
      <h2 className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--hero-muted)]">
        {t("site.trust.policiesTitle")}
      </h2>
      <ul className="mt-3 space-y-2">
        {docs.map((d) => (
          <li key={d.key}>
            <Link
              to={p(`/trust/${d.key}`)}
              className="text-sm text-[var(--hero-foreground)] underline-offset-4 hover:underline"
            >
              {d.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
/* Side-effect import: registers `site.profile.*` as this chunk is evaluated,
   before anything here renders. */
import "./profile-i18n";
import { getProfile, profilePdfUrl, type ProfilePresentation, type ProfileSection } from "@/lib/profile-api";
import { PublicApiError, messageFor } from "@/lib/api";
import { useBranding } from "@/app/branding";
import { getLang, setLang, tStatic } from "@/lib/i18n";
import { BrandGlyph, DownloadIcon, DocumentIcon } from "@/components/ui/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentMeta } from "@/lib/use-document-meta";

/**
 * `/profile/:token` — a tenant's Company Profile, shared with one recipient
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.6, §3.8).
 *
 * ── A DOCUMENT, NOT A MARKETING PAGE ───────────────────────────────────────
 *
 * Like the proposal page, this is read on a phone and then printed for
 * whoever decides, and the PDF beside it is rendered from the very object
 * this page renders. So **this page formats nothing**: every title, sentence
 * and figure arrives in the reader's language, already written. The page only
 * decides where the hairlines go. Items the tenant switched off were removed
 * on the server before the object was built, so there is nothing hidden here
 * to leak.
 *
 * ── THE TOKEN IS THE CREDENTIAL ────────────────────────────────────────────
 *
 * Revoked, expired or unknown all answer the same 404, and the page says to
 * ask for a fresh link. No login prompt. Each open is recorded by the server
 * (time and a coarse browser label, never an address) and the first one tells
 * the person who shared it.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { branding } = useBranding();

  // `?lang=` on a shared link is the reader asking for the other language of
  // THIS document; without it, the site's language.
  const requested = String(params.get("lang") || getLang().toUpperCase());
  const lang: "EN" | "FR" = requested === "FR" ? "FR" : "EN";
  // A link sent in French opens with French furniture too, not only French
  // content: the reader should not meet "Download PDF" over a French profile.
  const asked = params.get("lang");
  React.useEffect(() => {
    if (asked) setLang(lang === "FR" ? "fr" : "en");
  }, [asked, lang]);

  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "found"; p: ProfilePresentation }
    | { kind: "gone" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getProfile(decodeURIComponent(token), lang)
      .then((data) => {
        if (!alive) return;
        if (data?.presentation) setState({ kind: "found", p: data.presentation });
        else setState({ kind: "gone" });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound) setState({ kind: "gone" });
        else setState({ kind: "error", message: messageFor(e, tStatic("errors.loadFailed")) });
      });
    return () => {
      alive = false;
    };
  }, [token, lang]);

  const p = state.kind === "found" ? state.p : null;
  useDocumentMeta({ title: p ? `${p.company.name} · ${p.title}` : t("site.profile.title") });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="no-print border-b border-border">
        <div className="wrap flex items-center justify-between gap-4 py-3.5">
          <div className="flex items-center gap-2.5">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name || ""}
                className="h-7 w-auto max-w-40 object-contain object-left"
              />
            ) : (
              <>
                <BrandGlyph name={branding.name || "Praxis"} size={26} />
                <span className="font-display text-sm font-semibold tracking-tight">
                  {branding.name || "Praxis"}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label={t("site.profile.langSwitch")}
              className="flex items-center gap-1 rounded-[calc(var(--radius)-2px)] border border-border p-0.5"
            >
              {(["EN", "FR"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => {
                    setParams(l === "FR" ? { lang: "FR" } : {});
                    setLang(l === "FR" ? "fr" : "en");
                  }}
                  className="h-8 rounded-[calc(var(--radius)-4px)] px-2.5 text-xs font-semibold data-[on=true]:bg-accent"
                  data-on={lang === l}
                >
                  {l}
                </button>
              ))}
            </div>
            {p ? (
              <ButtonLink
                href={profilePdfUrl(decodeURIComponent(token), p.language)}
                size="sm"
                aria-label={t("site.profile.download")}
                className="inline-flex items-center gap-2 whitespace-nowrap"
              >
                <DownloadIcon size={15} />
                {/* "Télécharger le PDF" wraps beside the logo on a phone; the
                    short form is the visible one there, the full one the name. */}
                <span className="sm:hidden" aria-hidden="true">PDF</span>
                <span className="hidden sm:inline" aria-hidden="true">{t("site.profile.download")}</span>
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </header>

      <main className="wrap py-10 md:py-14">
        <div className="mx-auto max-w-4xl">
          {state.kind === "loading" ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-64" />
            </div>
          ) : state.kind === "error" ? (
            <ErrorState message={state.message} />
          ) : !p ? (
            <Card padded>
              <EmptyState
                title={t("site.profile.unavailable")}
                hint={t("site.profile.unavailableHint")}
                icon={<DocumentIcon size={22} />}
              />
            </Card>
          ) : (
            <ProfileDocument p={p} />
          )}
        </div>
      </main>
    </div>
  );
}

function ProfileDocument({ p }: { p: ProfilePresentation }) {
  const { t } = useTranslation();
  return (
    <article className="lux-card overflow-hidden print:border-0 print:bg-transparent">
      {p.company.cover_url ? (
        <img
          src={p.company.cover_url}
          alt=""
          className="aspect-[3/1] w-full object-cover"
          loading="eager"
          decoding="async"
        />
      ) : null}
      <div className="p-6 md:p-10">
        <header className="border-b border-border pb-6">
          <p className="eyebrow">{p.title}</p>
          <h1 className="section-title mt-2 text-balance">{p.company.name}</h1>
          {p.company.tagline ? (
            <p className="mt-2 text-pretty text-lg text-muted-foreground">{p.company.tagline}</p>
          ) : null}
          {p.version ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("site.profile.version", { n: p.version.number })}
            </p>
          ) : null}
        </header>
        {p.sections.map((s) => (
          <section key={s.key} className="border-b border-border py-6 last:border-b-0">
            <h2 className="text-title font-semibold tracking-tight">{s.title}</h2>
            <div className="mt-3">
              <SectionBody s={s} />
            </div>
          </section>
        ))}
        <footer className="no-print mt-4 flex justify-end gap-2">
          {/* A Button: printing is an action, not a destination. */}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            {t("site.profile.print")}
          </Button>
        </footer>
      </div>
    </article>
  );
}

const prose = "whitespace-pre-wrap text-pretty text-[0.9375rem] leading-7 text-muted-foreground";

/** One section, by its key. Every string is the server's. */
function SectionBody({ s }: { s: ProfileSection }) {
  switch (s.key) {
    case "who_we_are":
      return (
        <div className="space-y-4">
          {s.paragraphs.map((x) => (
            <div key={x.key}>
              {x.label ? <h3 className="font-semibold">{x.label}</h3> : null}
              <p className={prose}>{x.body}</p>
            </div>
          ))}
        </div>
      );
    case "services":
      return (
        <ul className="divide-y divide-border">
          {s.items.map((x, i) => (
            <li key={`${x.name}-${i}`} className="py-3">
              <p className="font-medium">{x.name}</p>
              {x.sentence ? <p className={prose}>{x.sentence}</p> : null}
            </li>
          ))}
        </ul>
      );
    case "capacity":
      return (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {s.figures.map((f) => (
              <div key={f.key} className="rounded-[var(--radius)] border border-border p-3">
                <dt className="micro">{f.label}</dt>
                <dd className="num mt-1 text-xl font-semibold">{f.value}</dd>
                {f.detail ? <dd className="text-sm text-muted-foreground">{f.detail}</dd> : null}
              </div>
            ))}
          </dl>
          {s.note ? <p className={prose}>{s.note}</p> : null}
        </div>
      );
    case "certifications":
      return (
        <ul className="grid gap-2 sm:grid-cols-2">
          {s.items.map((x, i) => (
            <li key={`${x.name}-${i}`} className="rounded-[var(--radius)] border border-border px-3 py-2">
              <span className="font-medium">{x.name}</span>{" "}
              <span className="text-sm text-muted-foreground">{x.kind}</span>
            </li>
          ))}
        </ul>
      );
    case "case_stories":
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {s.items.map((x, i) => (
            <div key={`${x.title}-${i}`} className="rounded-[var(--radius)] border border-border p-4">
              <h3 className="font-semibold">{x.title}</h3>
              <p className="text-sm text-muted-foreground">{x.client}</p>
              {x.summary ? <p className={`mt-2 ${prose}`}>{x.summary}</p> : null}
              {x.kpis.length ? (
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                  {x.kpis.map((k, j) => (
                    <div key={`${k.label}-${j}`}>
                      <dd className="num font-semibold">{k.value}</dd>
                      <dt className="text-xs text-muted-foreground">{k.label}</dt>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "clients":
      return (
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-5">
          {s.logos.map((l, i) => (
            <li key={`${l.name}-${i}`}>
              <img src={l.url} alt={l.name} className="h-10 w-auto max-w-36 object-contain" loading="lazy" decoding="async" />
            </li>
          ))}
        </ul>
      );
    case "why_us":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {s.items.map((x, i) => (
            <div key={`${x.title}-${i}`}>
              {x.title ? <h3 className="font-semibold">{x.title}</h3> : null}
              {x.body ? <p className={prose}>{x.body}</p> : null}
            </div>
          ))}
        </div>
      );
    case "contact":
      return (
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {s.lines.map((l) => (
            <div key={l.key}>
              <dt className="micro">{l.label}</dt>
              <dd className="mt-1">
                {l.href ? (
                  <a
                    href={l.href}
                    className="text-foreground underline underline-offset-2"
                    {...(l.key === "website" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {l.value}
                  </a>
                ) : (
                  l.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      );
    default:
      return null;
  }
}

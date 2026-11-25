import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { pickSlug, pickText, type ServiceCard } from "@/lib/services-api";
import { Section } from "@/components/site/section";
import { ArrowRightIcon, BoxIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";

/**
 * The homepage services band for a tenant that FEATURES services (SmartLS
 * website v2, PR 3; meeting decision 6): a dark photographic band, one card per
 * featured service, its one line in white and its closing line in the brand's
 * orange, a link to the full page and one to All Services.
 *
 * A tenant that features nothing keeps the band it had (`ServicesBand`): the
 * flag is data, so nothing changes for anyone who has not set it.
 *
 * The colours are the hero band's own tokens (`--hero-foreground`, and
 * `--primary-ink-hero` for orange text on dark), so the tenant's palette and the
 * contrast gate both hold.
 */
export function FeaturedServicesBand({ services }: { services: ServiceCard[] }) {
  const { t } = useTranslation();
  const lang = getLang();
  return (
    <Section
      id="services"
      variant="dark"
      eyebrow={t("site.services.eyebrow")}
      eyebrowIcon={BoxIcon}
      title={t("site.services.title")}
      lead={t("site.services.sub")}
      aside={
        <Link to={p("/services")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-hero-foreground underline-offset-4 hover:underline">
          {t("site.services.all")}
          <ArrowRightIcon size={16} />
        </Link>
      }
    >
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s, i) => {
          const name = pickText(s, "name", lang) || "";
          const line = pickText(s, "short_description", lang);
          const claim = pickText(s, "claim", lang);
          return (
            <Reveal as="li" key={s.service_type_id} delay={(i % 3) as 0 | 1 | 2} className="h-full">
              <Link
                to={p(`/services/${pickSlug(s, lang)}`)}
                className="group flex h-full flex-col overflow-hidden rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--hero-foreground)_16%,transparent)] no-underline"
              >
                {s.cover_url ? (
                  <div className="aspect-[16/10] w-full overflow-hidden">
                    <img
                      src={s.cover_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-lg font-semibold text-hero-foreground">{name}</h3>
                  {line ? <p className="mt-2 text-sm text-hero-foreground">{line}</p> : null}
                  {claim ? <p className="mt-3 text-sm font-semibold text-[var(--primary-ink-hero)]">{claim}</p> : null}
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-hero-foreground">
                    {t("site.services.more")}
                    <ArrowRightIcon size={14} />
                  </span>
                </div>
              </Link>
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}

export default FeaturedServicesBand;

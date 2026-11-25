import * as React from "react";
import { useTranslation } from "react-i18next";
import { coverUrl, shareLinks, type InsightCard } from "@/lib/insights-api";
import { cn } from "@/lib/cn";

/**
 * The pieces the Insights index and an article share (14680): the reading
 * time, the dated byline, and the share row. Their own file so each page file
 * exports only its page, which is what Fast Refresh needs.
 */

/** "6 min read", or nothing when the server sent no estimate. */
export function ReadingTime({ minutes }: { minutes?: number | null }) {
  const { t } = useTranslation();
  if (!minutes) return null;
  return <span className="num">{t("site.insights.minutes", { count: minutes })}</span>;
}

/**
 * The byline: name, then the role as it was on the article's date (14680), and
 * the photograph when one was uploaded. The photo drops itself on error, like
 * every other image on these pages.
 */
export function Byline({ article, className }: { article: InsightCard; className?: string }) {
  const [photoOk, setPhotoOk] = React.useState(true);
  const author = article.author;
  if (!author) return null;
  const photo = coverUrl(author.photo_id || null);
  return (
    <p className={cn("flex items-center gap-2 text-muted-foreground", className)}>
      {photo && photoOk && (
        <img
          src={photo}
          alt=""
          loading="lazy"
          onError={() => setPhotoOk(false)}
          className="h-7 w-7 rounded-full object-cover"
        />
      )}
      <span>
        <span className="font-medium text-foreground">{author.name}</span>
        {author.title ? ", " + author.title : ""}
      </span>
    </p>
  );
}


/**
 * Share to LinkedIn, WhatsApp and email (14680). Plain links: no third-party
 * script loads on the page and nothing tracks the reader. Each opens in a new
 * tab except email, which hands over to the reader's mail program.
 */
export function ShareLinks({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation();
  const links = shareLinks(url, title);
  const item =
    "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-[rgb(var(--ink)/0.05)]";
  return (
    <nav aria-label={t("site.insights.share")} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("site.insights.share")}</span>
      <a className={item} href={links.linkedin} target="_blank" rel="noopener noreferrer">
        {t("site.insights.shareLinkedIn")}
      </a>
      <a className={item} href={links.whatsapp} target="_blank" rel="noopener noreferrer">
        {t("site.insights.shareWhatsApp")}
      </a>
      <a className={item} href={links.email}>
        {t("site.insights.shareEmail")}
      </a>
    </nav>
  );
}

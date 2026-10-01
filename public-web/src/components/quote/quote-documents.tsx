import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { FilePicker, formatBytes } from "@/components/ui/file-input";
import { isSafeBlobUrl } from "@/lib/image-compress";
import { CheckIcon, CloseIcon, DocumentIcon } from "@/components/ui/icons";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/quote-scope";
import { QUOTE_DOC_ACCEPT, type QuoteDocuments as Docs } from "@/lib/use-quote-documents";

/**
 * The documents step — shared by both quote wizards (meeting 6, PR 2, owner
 * decisions Q4 and Q6).
 *
 * A line says WHY first: with the commercial invoice the team prices faster
 * and more accurately. Then what the next file is — Commercial invoice (first,
 * and marked recommended), Proforma, Packing list, BL / AWB, Photos of the
 * goods, Other — and the button to add it. Each file is listed with its
 * preview, its size (and what it was before compression), what it is, and its
 * own 0→100 % bar ending in "Upload complete".
 *
 * `required` is the portal's: a request is never sent without a document. The
 * website passes false — a stranger may not have one yet and must not be
 * turned away — and says the same thing as encouragement instead.
 *
 * The raw file input stays in components/ui/file-input.tsx (`FilePicker`), the
 * one place `praxis/no-raw-upload` allows it.
 */
export function QuoteDocumentsStep({
  docs,
  required,
  variant,
  error,
  idPrefix = "quote",
}: {
  docs: Docs;
  required: boolean;
  variant: "site" | "portal";
  error?: string | null;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = React.useState<DocumentKind>("COMMERCIAL_INVOICE");
  const hasInvoice = docs.items.some((d) => d.kind === "COMMERCIAL_INVOICE" && d.state !== "error");
  // Once the invoice is in, the next file is most likely something else.
  React.useEffect(() => {
    if (hasInvoice && kind === "COMMERCIAL_INVOICE") setKind("PACKING_LIST");
  }, [hasInvoice, kind]);

  const chipClass = (checked: boolean) =>
    variant === "portal"
      ? "pt-chip pt-chip-radio pt-chip-sm cursor-pointer"
      : cn(
          "inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[0.8125rem]",
          "hover:border-[rgb(var(--ink)/0.25)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--brand-orange))]",
          checked && "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange)/0.06)] font-semibold",
        );

  return (
    <div className="space-y-4">
      <p className={cn("rounded-[calc(var(--radius)-2px)] border p-3 text-sm", variant === "portal" ? "pt-card" : "bg-[var(--secondary)]")}>
        {t("site.quote.docsWhy")}{" "}
        <span className="text-muted-foreground">{required ? t("site.quote.docsRequired") : t("site.quote.docsOptional")}</span>
      </p>

      <fieldset>
        <legend className={variant === "site" ? "field-label" : "pt-label"}>{t("site.quote.docsKind")}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {DOCUMENT_KINDS.map((k) => (
            <label key={k} className={chipClass(kind === k)}>
              <input type="radio" name={`${idPrefix}-doc-kind`} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {t(`site.quote.doc${k}`)}
              {k === "COMMERCIAL_INVOICE" ? (
                <span className="rounded-full bg-[rgb(var(--ok)/0.12)] px-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[rgb(var(--ok))]">
                  {t("site.quote.docRecommended")}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      </fieldset>

      <FilePicker
        accept={QUOTE_DOC_ACCEPT}
        label={t("site.quote.docsAdd")}
        multiple
        disabled={docs.busy && variant === "site"}
        onPick={(files) => void docs.add(files, kind)}
        trigger={
          <span
            className={cn(
              "inline-flex min-h-[44px] items-center gap-2 font-semibold",
              variant === "portal" ? "pt-btn pt-btn-soft" : "rounded-[calc(var(--radius)-2px)] border border-dashed px-4 text-sm hover:bg-[rgb(var(--ink)/0.03)]",
            )}
          >
            <DocumentIcon size={18} />
            {t("site.quote.docsAddAs", { kind: t(`site.quote.doc${kind}`) })}
          </span>
        }
      />

      {docs.items.length ? (
        <ul className="space-y-2">
          {docs.items.map((d) => (
            <li key={d.id} className={cn("flex items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-3", variant === "portal" && "pt-card")}>
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded border bg-background">
                {isSafeBlobUrl(d.previewUrl) ? <img src={d.previewUrl} alt="" className="h-full w-full object-cover" /> : <DocumentIcon size={20} className="text-muted-foreground" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{d.name}</p>
                <p className="num text-xs text-muted-foreground">
                  {t(`site.quote.doc${d.kind}`)} · {formatBytes(d.bytes)}
                  {d.originalBytes ? ` · ${t("site.quote.docsWas", { size: formatBytes(d.originalBytes) })}` : ""}
                </p>
                {d.state === "error" ? (
                  <p role="alert" className="mt-1 text-sm text-[rgb(var(--bad))]">
                    {d.error}
                  </p>
                ) : d.state === "preparing" ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t("site.quote.docsPreparing")}</p>
                ) : d.state === "uploading" || d.state === "done" ? (
                  <div className="mt-1.5" role="status" aria-live="polite">
                    <div className="flex items-center justify-between text-xs">
                      {d.state === "done" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[rgb(var(--ok))]">
                          <CheckIcon size={14} />
                          {t("site.quote.docsComplete")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("site.quote.docsSending")}</span>
                      )}
                      <span className="num text-muted-foreground">{d.state === "done" ? 100 : d.pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--ink)/0.08)]">
                      <span
                        className={cn("block h-full rounded-full", d.state === "done" ? "bg-[rgb(var(--ok))]" : "bg-[rgb(var(--brand-orange))]")}
                        style={{ width: `${d.state === "done" ? 100 : Math.max(4, d.pct)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[calc(var(--radius)-4px)] text-muted-foreground hover:bg-[rgb(var(--ink)/0.06)]"
                onClick={() => docs.remove(d.id)}
                aria-label={t("site.quote.docsRemove", { name: d.name })}
                disabled={d.state === "uploading"}
              >
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {docs.note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {docs.note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

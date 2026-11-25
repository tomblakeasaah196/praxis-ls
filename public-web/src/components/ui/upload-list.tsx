import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/components/ui/file-input";
import { isSafeBlobUrl } from "@/lib/image-compress";
import { CheckIcon, CloseIcon, DocumentIcon } from "@/components/ui/icons";
import type { Upload } from "@/lib/use-upload";

/**
 * The files a form will send, as `useUpload` holds them: a preview from the
 * moment the picker closes, the size (and the size before compression), and a
 * 0 to 100 % bar while the form sends, ending in "Upload complete" once the
 * server has answered. A file the engine refused shows why, in place.
 *
 * public-web's UploadList, the counterpart of the ERP's in
 * `client/src/components/ui/image-upload.tsx` (CLAUDE.md rule three).
 */
export function UploadList({ upload, className }: { upload: Upload; className?: string }) {
  const { t } = useTranslation();
  if (!upload.items.length && !upload.note) return null;
  return (
    <div className={className}>
      {upload.items.length ? (
        <ul className="space-y-2">
          {upload.items.map((d) => (
            <li key={d.id} className="flex items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded border bg-background">
                {isSafeBlobUrl(d.previewUrl) ? (
                  <img src={d.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <DocumentIcon size={18} className="text-muted-foreground" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{d.name}</p>
                <p className="num text-xs text-muted-foreground">
                  {formatBytes(d.bytes)}
                  {d.originalBytes ? ` · ${t("site.upload.was", { size: formatBytes(d.originalBytes) })}` : ""}
                </p>
                {d.state === "error" ? (
                  <p role="alert" className="mt-1 text-sm text-[rgb(var(--bad))]">
                    {d.error}
                  </p>
                ) : d.state === "preparing" ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t("site.upload.preparing")}</p>
                ) : d.state === "uploading" || d.state === "done" ? (
                  <div className="mt-1.5" role="status" aria-live="polite">
                    <div className="flex items-center justify-between text-xs">
                      {d.state === "done" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[rgb(var(--ok))]">
                          <CheckIcon size={14} />
                          {t("site.upload.complete")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("site.upload.sending")}</span>
                      )}
                      <span className="num text-muted-foreground">{d.percent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--ink)/0.08)]">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          d.state === "done" ? "bg-[rgb(var(--ok))]" : "bg-[rgb(var(--brand-orange))]",
                        )}
                        style={{ width: `${d.state === "done" ? 100 : Math.max(4, d.percent)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[calc(var(--radius)-4px)] text-muted-foreground hover:bg-[rgb(var(--ink)/0.06)] disabled:opacity-40"
                onClick={() => upload.remove(d.id)}
                aria-label={t("site.upload.remove", { name: d.name })}
                disabled={d.state === "uploading"}
              >
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {upload.note ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {upload.note}
        </p>
      ) : null}
    </div>
  );
}

import * as React from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/careers-api";
import { withScheme } from "@/lib/format";
import { useIntake } from "@/lib/use-intake";
import { FilePicker } from "@/components/ui/file-input";
import {
  compressImage,
  isPreviewableImage,
  isSafeBlobUrl,
  previewUrlFor,
} from "@/lib/image-compress";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
// Registers `site.careers.*`, which lives in this chunk rather than in the
// entry dictionary. Imported for the side effect; see careers-i18n.ts.
import "./careers-i18n";

/**
 * The one form a stranger fills in about themselves — used twice.
 *
 * ── WHY IT IS ONE COMPONENT AND NOT TWO ───────────────────────────────────
 *
 * 13792 added a second way to send a CV: an application with no role attached,
 * for the far commoner state where the tenant is not hiring. It asks the SAME
 * questions. Copying the 200 lines below would have meant two file pickers, two
 * compression calls, two honeypots and two sets of field-error wiring — and the
 * copy would have been the one that stopped getting the fixes, because it is
 * the one on the page nobody demos.
 *
 * What actually differs is three strings and where the body is posted, so those
 * are the props. `requireCover` / `requirePortfolio` come from a vacancy's
 * `apply_config` on the role path and are simply false on the open one, because
 * a tenant cannot make a demand of an application they did not advertise.
 *
 * Everything load-bearing is unchanged from the form this was lifted out of:
 * the 8 MB check before the file is read, the compression before the bytes
 * leave the device, the preview from the moment the picker closes, and the
 * receipt that says whether the CV actually landed.
 */

/** Kept out of the JSX so the suppression comment stays on the line directly
 *  above `src` — Prettier re-wraps a long <img> and would separate them. */
const CV_PREVIEW_CLASS =
  "h-12 w-12 shrink-0 rounded border bg-background object-cover";

export type CandidateFormProps = {
  /** Where the body goes. The two callers differ in exactly this and the copy. */
  send: (body: api.ApplyInput) => Promise<api.ApplyResult>;
  /** From the vacancy's `apply_config`; both false for an open application. */
  requireCover?: boolean;
  requirePortfolio?: boolean;
  /** The free-text box means something different on each path: "why you are
   *  writing" against a role, "what you are looking for" without one. */
  coverLabel: string;
  coverHint: string;
  submitLabel: string;
  /** The confirmation. A render prop rather than a fixed block, because what a
   *  candidate should be told next is the one genuinely different thing: a role
   *  application has a pipeline behind it, an open one has a file. */
  renderSent: (result: api.ApplyResult) => React.ReactNode;
};

export function CandidateForm({
  send,
  requireCover = false,
  requirePortfolio = false,
  coverLabel,
  coverHint,
  submitLabel,
  renderSent,
}: CandidateFormProps) {
  const { t } = useTranslation();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);

  // An object URL pins the whole file in memory until it is revoked.
  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [cvDataUrl, setCvDataUrl] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    full_name: "",
    email: "",
    phone: "",
    address: "",
    experience_years: "",
    expected_salary: "",
    portfolio_url: "",
    cover_note: "",
  });
  const set = (k: keyof typeof f, val: string) =>
    setF((s) => ({ ...s, [k]: val }));

  const intake = useIntake<api.ApplyResult>({
    send: (body) => send(body as api.ApplyInput),
    onRateLimited: t("site.careers.limited"),
    onFailed: t("site.careers.err"),
  });

  const canSend =
    f.full_name.trim().length > 1 &&
    /.+@.+\..+/.test(f.email.trim()) &&
    (!requireCover || f.cover_note.trim().length > 0) &&
    (!requirePortfolio || f.portfolio_url.trim().length > 0) &&
    !intake.busy;

  async function pick(files: FileList | null) {
    const picked = files?.[0] || null;
    setFileError(null);
    setCvDataUrl(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setFile(picked);
    if (!picked) return;
    try {
      // Compressed before it is ever encoded. A CV photographed on a phone is
      // routinely 8–12 MB, and this is a stranger on a corridor connection with
      // no account and no second attempt: the resize is the difference between
      // an application that lands and one that times out. "document" keeps the
      // source format, so the company receives the kind of file it can open.
      const { file: prepared } = await compressImage(picked, "document");
      setFile(prepared);
      if (isPreviewableImage(prepared)) {
        // The preview this form never had. Attaching the wrong scan is
        // otherwise invisible — and a candidate has no account to check it from
        // afterwards. previewUrlFor proves the blob: contract at the sink.
        setPreview(previewUrlFor(prepared));
      }
      setCvDataUrl(await api.fileToDataUrl(prepared));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    await intake.submit({
      full_name: f.full_name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim() || undefined,
      address: f.address.trim() || undefined,
      // NO `skills`. The schema accepts them and the record stores them, but the
      // form does not ask the candidate for a skill list, and copying
      // `skills_required` in would write the job's own requirements into the
      // applicant's profile — where this product's CV scorer will read them back
      // as a match the person never claimed. A scaffold that inflates a score to
      // fill a column is worse than a null column.
      experience_years: f.experience_years
        ? Number(f.experience_years)
        : undefined,
      expected_salary: f.expected_salary
        ? Number(f.expected_salary)
        : undefined,
      portfolio_url: f.portfolio_url
        ? withScheme(f.portfolio_url.trim())
        : undefined,
      cover_note: f.cover_note.trim() || undefined,
      cv_data_url: cvDataUrl || undefined,
      cv_filename: file?.name,
    });
  }

  if (intake.result) return <>{renderSent(intake.result)}</>;

  return (
    <form onSubmit={submit} className="relative mt-4 space-y-3.5">
      {intake.error && (
        <p
          role="alert"
          className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
        >
          {intake.error}
        </p>
      )}
      <Input
        label={t("site.careers.fullName")}
        required
        autoComplete="name"
        value={f.full_name}
        error={intake.fields.full_name}
        onChange={(e) => set("full_name", e.target.value)}
      />
      <Input
        label={t("site.careers.email")}
        type="email"
        required
        autoComplete="email"
        value={f.email}
        error={intake.fields.email}
        onChange={(e) => set("email", e.target.value)}
      />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Input
          label={`${t("site.careers.phone")} (${t("site.careers.optional")})`}
          type="tel"
          autoComplete="tel"
          value={f.phone}
          error={intake.fields.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
        <Input
          label={`${t("site.careers.address")} (${t("site.careers.optional")})`}
          autoComplete="street-address"
          value={f.address}
          error={intake.fields.address}
          onChange={(e) => set("address", e.target.value)}
        />
        <Input
          label={`${t("site.careers.experience")} (${t("site.careers.optional")})`}
          type="number"
          min={0}
          max={70}
          inputMode="numeric"
          value={f.experience_years}
          error={intake.fields.experience_years}
          onChange={(e) => set("experience_years", e.target.value)}
        />
        <Input
          label={`${t("site.careers.expectedSalary")} (${t("site.careers.optional")})`}
          type="number"
          min={0}
          step="1000"
          inputMode="numeric"
          value={f.expected_salary}
          error={intake.fields.expected_salary}
          onChange={(e) => set("expected_salary", e.target.value)}
        />
      </div>
      <Input
        label={
          requirePortfolio
            ? t("site.careers.portfolio")
            : `${t("site.careers.portfolio")} (${t("site.careers.optional")})`
        }
        required={requirePortfolio}
        inputMode="url"
        placeholder="https://"
        value={f.portfolio_url}
        error={intake.fields.portfolio_url}
        onChange={(e) => set("portfolio_url", e.target.value)}
      />
      <Textarea
        label={
          requireCover ? coverLabel : `${coverLabel} (${t("site.careers.optional")})`
        }
        required={requireCover}
        hint={coverHint}
        rows={5}
        maxLength={5000}
        value={f.cover_note}
        error={intake.fields.cover_note}
        onChange={(e) => set("cover_note", e.target.value)}
      />

      <div>
        <p className="field-label">{t("site.careers.cv")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <FilePicker
            accept={api.CV_ACCEPT}
            label={t("site.careers.cv")}
            disabled={intake.busy}
            trigger={
              <span className="btn-surface inline-flex h-10 items-center rounded-[calc(var(--radius)-2px)] px-4 text-sm font-medium no-underline">
                {t("site.careers.cvPick")}
              </span>
            }
            onPick={(files) => void pick(files)}
          />
          {/* CodeQL reports js/xss-through-dom (high) on the `src` below, and
              it is a FALSE POSITIVE dismissed in the Security tab — not
              suppressed here. GitHub's CodeQL Action ignores source-code
              suppression comments (`// codeql[…]` / `// lgtm[…]` were an LGTM
              feature); alerts are dismissed through code scanning itself. A
              directive here would look like it was handling the alert while
              doing nothing, which is worse than no comment at all.

              The flow it traces is real: a file the visitor chose reaches a URL
              sink. What it cannot see is that `preview` can only ever be a `blob:`
              URL — `URL.createObjectURL` has no other possible return — and a
              blob: URL can neither execute nor be reinterpreted as markup. The
              schemes that would make this sink live, `data:text/html` and
              `javascript:`, are unreachable.

              What was tried, so nobody repeats it: asserting the prefix inside
              `previewUrlFor` (not followed across a module boundary); an inline
              `startsWith` on this conditional (not recognised as a barrier);
              and the named guard below (still reported).

              The guard STAYS regardless of the dismissal. It is not decoration
              — it is what catches the day someone swaps object URLs for a
              FileReader `data:` URL, where this sink genuinely would be live.
              image-compress.test.ts covers that rejection path.

              Revisit if this component ever takes its src from anywhere other
              than `previewUrlFor`. */}
          {isSafeBlobUrl(preview) ? (
            <img src={preview} alt="" className={CV_PREVIEW_CLASS} />
          ) : null}
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {file ? file.name : t("site.careers.cvNone")}
          </span>
        </div>

        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("site.careers.cvHint")}
        </p>
        {(fileError || intake.fields.cv_data_url) && (
          <p role="alert" className="mt-1.5 text-xs text-bad">
            {fileError || intake.fields.cv_data_url}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full justify-center"
        loading={intake.busy}
        disabled={!canSend}
      >
        {intake.busy ? t("site.careers.sending") : submitLabel}
      </Button>
    </form>
  );
}

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot, Input, Textarea } from "@/components/ui/field";
import { FilePicker } from "@/components/ui/file-input";
import { UploadList } from "@/components/ui/upload-list";
import { CheckIcon, CloseIcon, DocumentIcon } from "@/components/ui/icons";
import { HumanCheck, type HumanState } from "@/components/site/human-check";
import { sendWebsiteMessage } from "@/lib/intake-upload";
import { useIntake } from "@/lib/use-intake";
import { useUpload } from "@/lib/use-upload";

/**
 * The message button's panel (SmartLS website v2, PR 2).
 *
 * ── TWO STEPS, EMAIL FIRST ───────────────────────────────────────────────
 *
 * The meeting's decision: the visitor gives an email before anything else.
 * It is the only way the desk can answer, the acknowledgement goes to it, and
 * it is remembered in `sessionStorage` for the browser session, so a visitor
 * who writes twice is not asked twice. Then the message, optional details and
 * optional files. When it is sent, the reference is on screen, with Copy.
 *
 * ── KEYBOARD AND SCREEN READER ───────────────────────────────────────────
 *
 * A modal dialog: `role="dialog"`, `aria-modal`, named by its heading. Focus
 * moves into it on open, Tab cycles inside it, Escape closes it, and closing
 * returns focus to the launcher (`message-button.tsx`). Every control has a
 * visible label; errors are announced (`role="alert"`) and tied to their field.
 *
 * ── MOTION ───────────────────────────────────────────────────────────────
 *
 * None. The panel appears and disappears; there is nothing to reduce.
 *
 * ── NOTHING TYPED IS LOST ────────────────────────────────────────────────
 *
 * The draft message is kept in `sessionStorage` too, so closing the panel to
 * check a detail on the page and opening it again finds the text where it was.
 */

const EMAIL_KEY = "praxis.site.message.email";
const DRAFT_KEY = "praxis.site.message.draft";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
const EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".docx", ".xlsx"] as const;
const ACCEPT = [...EXTENSIONS, ...TYPES].join(",");
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** sessionStorage can throw (private mode, storage off); the panel works without it. */
function readSession(key: string): string {
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    /* @silent:storage storage unavailable: the panel simply asks again */
    return "";
  }
}
function writeSession(key: string, value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* @silent:storage storage unavailable: nothing to remember, nothing lost */
  }
}

type Draft = { message: string; name: string; company_name: string; phone: string };
const EMPTY: Draft = { message: "", name: "", company_name: "", phone: "" };

function readDraft(): Draft {
  const raw = readSession(DRAFT_KEY);
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* @silent:parse a damaged draft is dropped, not shown */
    return EMPTY;
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function MessagePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  const [email, setEmail] = React.useState(() => readSession(EMAIL_KEY));
  const [step, setStep] = React.useState<"email" | "write">(() => (EMAIL_RE.test(readSession(EMAIL_KEY)) ? "write" : "email"));
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(readDraft);
  const [human, setHuman] = React.useState<HumanState>("pending");
  const [copied, setCopied] = React.useState(false);

  const upload = useUpload({
    profile: "document",
    autoStart: false,
    types: TYPES,
    extensions: EXTENSIONS,
    maxFiles: MAX_FILES,
    maxTotalBytes: MAX_TOTAL_BYTES,
    messages: {
      badType: t("site.upload.badType"),
      tooMany: t("site.upload.tooMany"),
      totalTooBig: t("site.upload.totalTooBig"),
      unreadable: t("site.upload.unreadable"),
    },
  });

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) =>
      sendWebsiteMessage(body as Parameters<typeof sendWebsiteMessage>[0], startedAt, (pct) => upload.setProgress(pct)),
    onRateLimited: t("site.message.limited"),
    onFailed: t("site.message.err"),
  });

  // Keep the draft for the session; forget it once it has been sent.
  React.useEffect(() => {
    if (intake.result) return;
    const empty = !draft.message && !draft.name && !draft.company_name && !draft.phone;
    writeSession(DRAFT_KEY, empty ? null : JSON.stringify(draft));
  }, [draft, intake.result]);

  // Focus into the panel on open and on every step change.
  React.useEffect(() => {
    const el = panel.current?.querySelector<HTMLElement>("[data-autofocus]");
    (el || panel.current)?.focus();
  }, [step, intake.result]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setEmailError(t("site.message.emailInvalid"));
      return;
    }
    setEmailError(null);
    setEmail(value);
    writeSession(EMAIL_KEY, value);
    setStep("write");
  }

  const canSend =
    draft.message.trim().length > 0 &&
    !intake.busy &&
    !upload.busy &&
    (human === "off" || human === "ready");

  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    const documents = upload.count ? await upload.payload() : undefined;
    const r = await intake.submit({
      email: email.trim(),
      message: draft.message.trim(),
      name: draft.name.trim() || undefined,
      company_name: draft.company_name.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      documents,
      origin_page: window.location.pathname.slice(0, 300) || "/",
    });
    if (r) {
      upload.setProgress(100, true);
      writeSession(DRAFT_KEY, null);
    } else {
      upload.rewind();
    }
  }

  function writeAnother() {
    setDraft(EMPTY);
    upload.reset();
    intake.reset();
    setCopied(false);
  }

  async function copyRef(ref: string) {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
    } catch {
      /* @silent:storage clipboard refused: the reference is on screen to read */
    }
  }

  return (
    <div
      ref={panel}
      id="site-message-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[calc(var(--radius)+4px)] border bg-background text-foreground shadow-2xl outline-none md:inset-x-auto md:bottom-24 md:right-6 md:w-[400px] md:max-h-[min(680px,calc(100dvh-8rem))] md:rounded-[calc(var(--radius)+4px)]"
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {intake.result ? t("site.message.sentTitle") : t("site.message.title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("site.message.close")}
          className="grid h-9 w-9 place-items-center rounded-[calc(var(--radius)-4px)] text-muted-foreground hover:bg-[rgb(var(--ink)/0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--brand-orange))]"
        >
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {intake.result ? (
          <div className="space-y-4" role="status">
            <div>
              <p className="text-sm text-muted-foreground">{t("site.message.sentRef")}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="num font-mono text-lg font-semibold tracking-tight">{intake.result.reference}</span>
                <button
                  type="button"
                  data-autofocus
                  onClick={() => void copyRef(intake.result!.reference)}
                  className="btn-surface inline-flex h-8 items-center gap-1 rounded-[calc(var(--radius)-4px)] px-2.5 text-sm"
                >
                  {copied ? <CheckIcon size={14} /> : null}
                  {copied ? t("site.message.copied") : t("site.message.copy")}
                </button>
              </div>
            </div>
            <p className="text-sm">{t("site.message.sentCopy", { email })}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={writeAnother}>
                {t("site.message.another")}
              </Button>
              <Button type="button" onClick={onClose}>
                {t("site.message.close")}
              </Button>
            </div>
          </div>
        ) : step === "email" ? (
          <form onSubmit={submitEmail} noValidate className="space-y-4">
            <Input
              label={t("site.message.email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              data-autofocus
              placeholder={t("site.message.emailPlaceholder")}
              value={email}
              error={emailError || undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
            />
            <Button type="submit" className="w-full justify-center">
              {t("site.message.next")}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitMessage} className="relative space-y-4">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="min-w-0 break-all">{t("site.message.writingAs", { email })}</span>
              <button
                type="button"
                onClick={() => setStep("email")}
                className="font-semibold text-foreground underline underline-offset-2"
              >
                {t("site.message.change")}
              </button>
            </p>
            {intake.error ? (
              <p role="alert" className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm">
                {intake.error}
              </p>
            ) : null}
            <Textarea
              label={t("site.message.body")}
              required
              rows={5}
              maxLength={20000}
              data-autofocus
              placeholder={t("site.message.bodyPlaceholder")}
              value={draft.message}
              error={intake.fields.message}
              onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
            />
            <fieldset className="space-y-3">
              <legend className="field-label">{t("site.message.details")}</legend>
              <Input
                label={t("site.message.name")}
                autoComplete="name"
                value={draft.name}
                error={intake.fields.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={t("site.message.company")}
                  autoComplete="organization"
                  value={draft.company_name}
                  error={intake.fields.company_name}
                  onChange={(e) => setDraft((d) => ({ ...d, company_name: e.target.value }))}
                />
                <Input
                  label={t("site.message.phone")}
                  type="tel"
                  autoComplete="tel"
                  value={draft.phone}
                  error={intake.fields.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                />
              </div>
            </fieldset>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <FilePicker
                  accept={ACCEPT}
                  label={t("site.message.attach")}
                  multiple
                  disabled={intake.busy}
                  onPick={(files) => void upload.pick(files)}
                  trigger={
                    <span className="inline-flex min-h-[40px] items-center gap-2 rounded-[calc(var(--radius)-2px)] border border-dashed px-3 text-sm font-semibold hover:bg-[rgb(var(--ink)/0.03)]">
                      <DocumentIcon size={16} />
                      {t("site.message.attach")}
                    </span>
                  }
                />
                <span className="text-xs text-muted-foreground">{t("site.message.attachTypes")}</span>
              </div>
              <UploadList upload={upload} />
              {intake.fields.documents ? (
                <p role="alert" className="text-sm text-[rgb(var(--bad))]">
                  {intake.fields.documents}
                </p>
              ) : null}
            </div>
            <HumanCheck action="message" onState={setHuman} />
            {human === "error" ? (
              <p role="alert" className="text-sm text-[rgb(var(--bad))]">
                {t("errors.humanCheckUnavailable")}
              </p>
            ) : null}
            <Honeypot id="site-message-website-url" value={intake.honeypot} onChange={intake.setHoneypot} />
            <Button type="submit" className="w-full justify-center" loading={intake.busy} disabled={!canSend}>
              {intake.busy ? t("site.message.sending") : t("site.message.send")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot, Input, Select, Textarea } from "@/components/ui/field";
import { SuccessState } from "@/components/state";
import { FilePicker } from "@/components/ui/file-input";
import { UploadList } from "@/components/ui/upload-list";
import { DocumentIcon } from "@/components/ui/icons";
import { HumanCheck, type HumanState } from "@/components/site/human-check";
import { sendContactEnquiry } from "@/lib/intake-upload";
import { useIntake } from "@/lib/use-intake";
import { useUpload } from "@/lib/use-upload";

/**
 * The general enquiry — `POST /public/intake/contact-enquiries`, which lands in
 * the tenant's inbound-intake queue (`sales/inbound_intake`) tagged
 * `source: "WEBSITE"`.
 *
 * `enquiry_type` is exposed as a choice because the enum already exists server-side
 * and because routing matters more on a public form than anywhere else in the
 * product: a customs question that arrives as "general" waits behind a newsletter
 * sign-up, and the person who filed it has already given up. It is
 * `GENERAL_ENQUIRY` if the visitor would not pick.
 *
 * Only `message` is required by the schema (`min(1)`), and only `message` is
 * required here. A contact form that demands a phone number from someone who
 * wants to email is a form that gets abandoned.
 */
/** What a visitor may attach (SmartLS website v2, PR 2): sniffed again on the server. */
const FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
const FILE_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".docx", ".xlsx"] as const;
const FILE_ACCEPT = [...FILE_EXTENSIONS, ...FILE_TYPES].join(",");

const TYPES = [
  { value: "GENERAL_ENQUIRY", key: "site.contact.typeGeneral" },
  { value: "PARTNERSHIP", key: "site.contact.typePartnership" },
  { value: "CAREERS", key: "site.contact.typeCareers" },
  { value: "MEDIA", key: "site.contact.typeMedia" },
] as const;

/**
 * `defaultType` opens the form on one enquiry type: the For Partners page opens
 * it on PARTNERSHIP, so an agent's offer reaches the desk that handles agents
 * without the agent having to know our categories. The choice stays editable.
 */
export function ContactForm({
  defaultType = "GENERAL_ENQUIRY",
}: { defaultType?: (typeof TYPES)[number]["value"] } = {}) {
  const { t } = useTranslation();
  const [f, setF] = React.useState({
    name: "",
    company_name: "",
    email: "",
    phone: "",
    subject: "",
    enquiry_type: defaultType as string,
    message: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  // Files go up with the message, on Send (CLAUDE.md rule three).
  const upload = useUpload({
    profile: "document",
    autoStart: false,
    types: FILE_TYPES,
    extensions: FILE_EXTENSIONS,
    maxFiles: 10,
    maxTotalBytes: 20 * 1024 * 1024,
    messages: {
      badType: t("site.upload.badType"),
      tooMany: t("site.upload.tooMany"),
      totalTooBig: t("site.upload.totalTooBig"),
      unreadable: t("site.upload.unreadable"),
    },
  });
  // The bot check (website v2, PR 2). "off" when the tenant has no keys.
  const [human, setHuman] = React.useState<HumanState>("pending");

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) =>
      sendContactEnquiry(
        body as Parameters<typeof sendContactEnquiry>[0],
        startedAt,
        (pct) => upload.setProgress(pct),
      ),
    onRateLimited: t("site.contact.limited"),
    onFailed: t("site.contact.err"),
  });

  const canSend =
    f.message.trim().length > 0 &&
    !intake.busy &&
    !upload.busy &&
    (human === "off" || human === "ready");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    const documents = upload.count ? await upload.payload() : undefined;
    const r = await intake.submit({
      name: f.name.trim() || undefined,
      company_name: f.company_name.trim() || undefined,
      email: f.email.trim() || undefined,
      phone: f.phone.trim() || undefined,
      subject: f.subject.trim() || undefined,
      enquiry_type: f.enquiry_type,
      message: f.message.trim(),
      documents,
      origin_page: window.location.pathname.slice(0, 300) || "/",
    });
    if (r) {
      upload.setProgress(100, true);
      setF((s) => ({ ...s, subject: "", message: "" }));
    } else {
      upload.rewind();
    }
  }

  if (intake.result) {
    return (
      <SuccessState
        title={t("site.contact.sent")}
        // The same value the quote desk hands back, and until now the only
        // place on the site that rendered it as ordinary prose: interpolated
        // into a sentence, in the body face, with proportional figures. A
        // reference is a code — it gets read down a phone line and typed back —
        // so it is set in the code face here exactly as it is in the quote
        // receipt and in the tracking field, and for the same reason.
        hint={
          intake.result.reference ? (
            <>
              {t("site.quote.reference")}{" "}
              <span className="num font-mono font-semibold tracking-tight text-foreground">
                {intake.result.reference}
              </span>
            </>
          ) : undefined
        }
      />
    );
  }

  return (
    <form onSubmit={submit} className="relative space-y-4">
      {intake.error && (
        <p
          role="alert"
          className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
        >
          {intake.error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("site.quote.name")}
          autoComplete="name"
          value={f.name}
          error={intake.fields.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <Input
          label={t("site.quote.company")}
          autoComplete="organization"
          value={f.company_name}
          error={intake.fields.company_name}
          onChange={(e) => set("company_name", e.target.value)}
        />
        <Input
          label={t("site.quote.email")}
          type="email"
          autoComplete="email"
          value={f.email}
          error={intake.fields.email}
          onChange={(e) => set("email", e.target.value)}
        />
        <Input
          label={t("site.quote.phone")}
          type="tel"
          autoComplete="tel"
          value={f.phone}
          error={intake.fields.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("site.contact.subject")}
          value={f.subject}
          error={intake.fields.subject}
          onChange={(e) => set("subject", e.target.value)}
        />
        <Select
          label={t("site.contact.type")}
          value={f.enquiry_type}
          onChange={(e) => set("enquiry_type", e.target.value)}
          options={TYPES.map((o) => ({ value: o.value, label: t(o.key) }))}
        />
      </div>
      <Textarea
        label={t("site.contact.message")}
        required
        rows={5}
        maxLength={20000}
        value={f.message}
        error={intake.fields.message}
        onChange={(e) => set("message", e.target.value)}
      />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <FilePicker
            accept={FILE_ACCEPT}
            label={t("site.contact.attach")}
            multiple
            disabled={intake.busy}
            onPick={(files) => void upload.pick(files)}
            trigger={
              <span className="inline-flex min-h-[44px] items-center gap-2 rounded-[calc(var(--radius)-2px)] border border-dashed px-4 text-sm font-semibold hover:bg-[rgb(var(--ink)/0.03)]">
                <DocumentIcon size={18} />
                {t("site.contact.attach")}
              </span>
            }
          />
          <span className="text-xs text-muted-foreground">{t("site.contact.attachTypes")}</span>
        </div>
        <UploadList upload={upload} />
        {intake.fields.documents ? (
          <p role="alert" className="text-sm text-[rgb(var(--bad))]">
            {intake.fields.documents}
          </p>
        ) : null}
      </div>
      <HumanCheck action="contact" onState={setHuman} />
      {human === "error" ? (
        <p role="alert" className="text-sm text-[rgb(var(--bad))]">
          {t("errors.humanCheckUnavailable")}
        </p>
      ) : null}
      <Honeypot value={intake.honeypot} onChange={intake.setHoneypot} />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          loading={intake.busy}
          disabled={!canSend}
        >
          {intake.busy ? t("site.contact.sending") : t("site.contact.send")}
        </Button>
      </div>
    </form>
  );
}

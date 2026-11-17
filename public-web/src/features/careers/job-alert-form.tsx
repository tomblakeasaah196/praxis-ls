import * as React from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/careers-api";
import { currentLocale } from "@/lib/i18n";
import { useIntake } from "@/lib/use-intake";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SuccessState } from "@/components/state";
import { DocumentIcon } from "@/components/ui/icons";
// Registers `site.careers.*`; the page that opens this form already did, and
// importing it here keeps the form correct wherever it is rendered.
import "./careers-i18n";

/**
 * Two fields and a promise.
 *
 * `locale` is sent because the page knows what language it is being read in and
 * the digest is written in one — a careers page served in French that then
 * mails in English is the same defect as an untranslated advert, arriving a
 * fortnight later.
 *
 * The confirmation never says whether the address was already subscribed.
 * `careers.service` explains why: an answer that distinguishes the two turns
 * this form into a way of testing whether a named person is on a named
 * company's list.
 */
export function JobAlertForm() {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");

  const intake = useIntake<{ received: boolean }>({
    send: (body) => api.subscribeAlert(body as api.AlertInput),
    onRateLimited: t("site.careers.limited"),
    onFailed: t("site.careers.err"),
  });

  const canSend = /.+@.+\..+/.test(email.trim()) && !intake.busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    await intake.submit({
      email: email.trim(),
      name: name.trim() || undefined,
      locale: currentLocale().startsWith("fr") ? "fr" : "en",
    });
  }

  return (
    <Panel className="mt-4" title={t("site.careers.alertTitle")}>
      {intake.result ? (
        <SuccessState
          title={t("site.careers.alertSentTitle")}
          hint={t("site.careers.alertSentNote")}
        />
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          <p className="max-w-measure text-sm text-muted-foreground">
            {t("site.careers.alertLead")}
          </p>
          {intake.error && (
            <p
              role="alert"
              className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
            >
              {intake.error}
            </p>
          )}
          <Input
            label={t("site.careers.alertEmail")}
            type="email"
            required
            autoComplete="email"
            value={email}
            error={intake.fields.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label={`${t("site.careers.alertName")} (${t("site.careers.optional")})`}
            autoComplete="name"
            value={name}
            error={intake.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <DocumentIcon size={14} />
            {t("site.careers.alertConsent")}
          </p>
          <Button
            type="submit"
            size="lg"
            className="w-full justify-center"
            loading={intake.busy}
            disabled={!canSend}
          >
            {intake.busy
              ? t("site.careers.alertSending")
              : t("site.careers.alertCta")}
          </Button>
        </form>
      )}
    </Panel>
  );
}

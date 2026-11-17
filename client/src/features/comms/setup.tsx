/**
 * Comms → Setup → Company Mail → System Email (administrators).
 *
 * The shared SMTP login the product's own emails go out through: OTPs,
 * invoices, notifications. Secrets are write-only: blank keeps the current
 * value. The DNS setup guide opens from the section's one button.
 *
 * This used to be a tab of its own ("Senders & Channels") that drew a second
 * page header, a "Back to inbox" button and a troubleshooting card inside the
 * tab, under a paragraph about "section senders" that Review #25 had already
 * removed. It is now the third section of the Company Mail tab and nothing
 * else: the form, Test, Save and the guide.
 */
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { Panel } from "@/components/ui/panel";
import { useResource, errMsg } from "@/lib/use-resource";
import * as scapi from "@/lib/smartcomm-api";
import { SmtpErrorGuide } from "@/components/mail/smtp-guide";
import { MailSetupWizard } from "./mail-setup-wizard";

/* Live test result line for the SMTP card. */
function TestLine({ result }: { result: scapi.TestResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <span className="micro text-[rgb(var(--ok))]">
      ✓ {tr("Connected")}
      {typeof result.smtp_host === "string" ? ` · ${result.smtp_host}` : ""}
    </span>
  ) : (
    <span className="micro text-[rgb(var(--bad))]">
      ✗ {String(result.error || tr("Failed")).slice(0, 80)}
    </span>
  );
}

export function SystemEmailSection() {
  const [guideOpen, setGuideOpen] = React.useState(false);
  const cfg = useResource(() => scapi.getCommsConfig(), []);
  const em = cfg.data?.email;

  // SMTP
  const [emF, setEmF] = React.useState({
    smtp_host: "",
    smtp_port: "",
    smtp_user: "",
    smtp_pass: "",
  });
  const [emBusy, setEmBusy] = React.useState(false);
  const [emTest, setEmTest] = React.useState<scapi.TestResult | null>(null);
  const [emErr, setEmErr] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (em)
      setEmF((s) => ({
        ...s,
        smtp_host: em.smtp_host || "",
        smtp_port: em.smtp_port ? String(em.smtp_port) : "",
        smtp_user: em.smtp_user || "",
      }));
  }, [em]);
  async function saveEm(e: React.FormEvent) {
    e.preventDefault();
    setEmBusy(true);
    setEmErr(null);
    setEmTest(null);
    try {
      await scapi.setEmailConfig({
        smtp_host: emF.smtp_host || undefined,
        smtp_port: emF.smtp_port === "" ? undefined : Number(emF.smtp_port),
        smtp_user: emF.smtp_user || undefined,
        smtp_pass: emF.smtp_pass || undefined,
      });
      setEmF((s) => ({ ...s, smtp_pass: "" }));
      cfg.reload();
    } catch (err) {
      setEmErr(err);
    } finally {
      setEmBusy(false);
    }
  }
  async function testEm() {
    setEmTest(null);
    setEmErr(null);
    try {
      setEmTest(await scapi.testEmail());
    } catch (err) {
      setEmErr(err);
    }
  }

  return (
    <Panel
      title={tr("System Email")}
      action={
        <span className="flex items-center gap-2">
          <Pill tone={em?.pass_set ? "ok" : "warn"}>
            {em?.pass_set ? tr("Password Set") : tr("Not Set")}
          </Pill>
          <Button size="sm" variant="outline" onClick={() => setGuideOpen(true)}>
            {tr("Setup Guide")}
          </Button>
        </span>
      }
    >
      <form onSubmit={saveEm}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("SMTP Host")}>
            <Input
              value={emF.smtp_host}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_host: e.target.value }))
              }
              placeholder="smtp.provider.com"
            />
          </Field>
          <Field label={tr("SMTP Port")}>
            <Input
              type="number"
              className="num"
              value={emF.smtp_port}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_port: e.target.value }))
              }
              placeholder="587"
            />
          </Field>
          <Field label={tr("SMTP User")}>
            <Input
              value={emF.smtp_user}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_user: e.target.value }))
              }
              placeholder="apikey / user"
            />
          </Field>
          <Field
            label={tr("SMTP Password")}
            hint={em?.pass_set ? tr("Leave blank to keep the current password.") : undefined}
          >
            <Input
              type="password"
              value={emF.smtp_pass}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_pass: e.target.value }))
              }
              placeholder="••••••"
            />
          </Field>
        </div>
        {emErr != null && (
          <div className="mt-2">
            <ErrorState message={errMsg(emErr)} />
            <SmtpErrorGuide err={emErr} />
          </div>
        )}
        {emTest && !emTest.ok && (
          <SmtpErrorGuide code={emTest.code} message={emTest.error} />
        )}
        <div className="mt-3 flex items-center justify-end gap-3">
          <TestLine result={emTest} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={testEm}
            disabled={emBusy}
          >
            {tr("Test")}
          </Button>
          <Button type="submit" size="sm" loading={emBusy} disabled={emBusy}>
            {tr("Save")}
          </Button>
        </div>
      </form>

      {guideOpen && (
        <MailSetupWizard
          open
          onClose={() => setGuideOpen(false)}
          onDone={() => setGuideOpen(false)}
        />
      )}
    </Panel>
  );
}

/**
 * Settings › Website › Messages (SmartLS website v2, PR 2).
 *
 * Where a website visitor's message goes, which mailbox sends it, and the bot
 * check in front of the forms. Three cards, each saved on its own:
 *
 *   · WEBSITE INBOX. Every message from the message button and the contact
 *     form is emailed here, with the visitor as Reply-To and the reference in
 *     the subject. It is ALSO in Sales › General Enquiries, as before.
 *   · SENDING MAILBOX. The address those emails leave from, and its SMTP
 *     server. The password is written once and never shown again: it is an
 *     encrypted integration secret (`website_smtp_pass`). Left empty, the
 *     company's usual email settings send instead.
 *   · SPAM CHECK. Cloudflare Turnstile's two keys. The site key is public by
 *     design; the secret key is an encrypted integration secret
 *     (`turnstile_secret`) and never leaves the server. Without both keys the
 *     forms keep working on hidden fields and timing alone.
 *
 * The website reads the LIVE environment, so these are entered there.
 *
 * The shapes are `@praxis/shared` websiteMessages, the same definition the API
 * checks on Save.
 */
import * as React from "react";
import { websiteMessages } from "@shared";
import { PageHeader } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import { ApiError, tenant } from "@/lib/api-client";
import { useCan } from "@/lib/route-access";
import { WebsiteNav } from "./website-nav";

type Delivery = {
  inbox: string;
  from_address: string;
  from_name: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
};

const EMPTY: Delivery = { inbox: "", from_address: "", from_name: "", smtp_host: "", smtp_port: "", smtp_user: "" };

/** One setting's value, or null when it has never been saved. */
async function readSetting<T>(key: string): Promise<T | null> {
  try {
    const row = await tenant<{ value: T }>(`/settings/website_messages/${key}`);
    return row ? row.value : null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Whether an integration secret has been saved. Never its value. */
async function secretSaved(key: string): Promise<boolean> {
  try {
    await tenant(`/settings/integration_secret/${key}`);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

const saveSecret = (key: string, provider: string, label: string, secret: string) =>
  tenant(`/settings/integration_secret/${key}`, {
    method: "PUT",
    body: { value: { provider, key_name: label, secret } },
  });

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function WebsiteMessagesPage() {
  const can = useCan("MOD-70");
  const [form, setForm] = React.useState<Delivery>(EMPTY);
  const [password, setPassword] = React.useState("");
  const [passwordSaved, setPasswordSaved] = React.useState(false);
  const [siteKey, setSiteKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [secretIsSaved, setSecretIsSaved] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>("load");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = React.useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const [d, t, pw, sk] = await Promise.all([
        readSetting<Record<string, unknown>>("delivery"),
        readSetting<Record<string, unknown>>("turnstile"),
        secretSaved("website_smtp_pass"),
        secretSaved("turnstile_secret"),
      ]);
      setForm({
        inbox: str(d?.inbox),
        from_address: str(d?.from_address),
        from_name: str(d?.from_name),
        smtp_host: str(d?.smtp_host),
        smtp_port: str(d?.smtp_port),
        smtp_user: str(d?.smtp_user),
      });
      setSiteKey(str(t?.site_key));
      setPasswordSaved(pw);
      setSecretIsSaved(sk);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof Delivery, v: string) => {
    setNotice(null);
    setFieldErrors((f) => ({ ...f, [k]: "" }));
    setForm((s) => ({ ...s, [k]: v }));
  };

  async function saveDelivery() {
    setNotice(null);
    const parsed = websiteMessages.deliverySetting.safeParse(form);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const issue of parsed.error.issues) out[String(issue.path[0])] = issue.message;
      setFieldErrors(out);
      return;
    }
    setBusy("delivery");
    try {
      await tenant("/settings/website_messages/delivery", { method: "PUT", body: { value: parsed.data } });
      if (password.trim()) {
        await saveSecret("website_smtp_pass", "smtp", "Website sending mailbox", password);
        setPassword("");
        setPasswordSaved(true);
      }
      setNotice({ tone: "ok", text: tr("Saved. New website messages use these settings.") });
    } catch (e) {
      setNotice({ tone: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setNotice(null);
    setBusy("test");
    try {
      const out = await tenant<{ to: string }>("/intake/website-mail/test", { method: "POST" });
      setNotice({ tone: "ok", text: `${tr("Test message sent to")} ${out?.to || form.inbox}.` });
    } catch (e) {
      setNotice({ tone: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveTurnstile() {
    setNotice(null);
    setBusy("turnstile");
    try {
      const parsed = websiteMessages.turnstileSetting.safeParse({ site_key: siteKey });
      if (!parsed.success) {
        setFieldErrors((f) => ({ ...f, site_key: parsed.error.issues[0]?.message || "" }));
        return;
      }
      await tenant("/settings/website_messages/turnstile", { method: "PUT", body: { value: parsed.data } });
      if (secret.trim()) {
        await saveSecret("turnstile_secret", "turnstile", "Website spam check", secret.trim());
        setSecret("");
        setSecretIsSaved(true);
      }
      setNotice({ tone: "ok", text: tr("Saved. The website forms pick this up within five minutes.") });
    } catch (e) {
      setNotice({ tone: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function testTurnstile() {
    setNotice(null);
    setBusy("turnstile-test");
    try {
      const out = await tenant<{ ok?: boolean; error?: string }>("/settings/integration_secret/turnstile_secret/test", { method: "POST" });
      setNotice(out?.ok
        ? { tone: "ok", text: tr("Cloudflare accepted the secret key.") }
        : { tone: "bad", text: out?.error || tr("The secret key could not be checked.") });
    } catch (e) {
      setNotice({ tone: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  const editable = can("edit");
  const loading = busy === "load";

  return (
    <>
      <PageHeader
        title={tr("Website Messages")}
        description={tr(
          "Where the website's messages are emailed, which mailbox sends them, and the spam check in front of the forms. Enter these in the live environment: the website reads live.",
        )}
      />
      <WebsiteNav />

      {error && <ErrorState message={error} />}
      {notice && (
        <Callout tone={notice.tone === "ok" ? "ok" : "bad"} className="mb-4">
          {notice.text}
        </Callout>
      )}

      <div className="flex flex-col gap-4">
        <SettingsCard
          title={tr("Website Inbox")}
          desc={tr(
            "Every message from the message button and the contact form is emailed here, with the visitor as the reply address and the message reference in the subject. Each one is also kept in Sales, General Enquiries.",
          )}
        >
          <div className="grid gap-3 md:max-w-md">
            <Field label={tr("Inbox Address")}>
              <Input
                type="email"
                autoComplete="off"
                placeholder="info@company.com"
                value={form.inbox}
                disabled={loading || !editable}
                aria-invalid={fieldErrors.inbox ? true : undefined}
                onChange={(e) => set("inbox", e.target.value)}
              />
            </Field>
            {fieldErrors.inbox && <p className="text-sm text-[var(--bad)]">{fieldErrors.inbox}</p>}
          </div>
        </SettingsCard>

        <SettingsCard
          title={tr("Sending Mailbox")}
          desc={tr(
            "The mailbox the inbox copy and the visitor's acknowledgement are sent from. Leave the server empty to use the company's usual email settings instead.",
          )}
          action={
            <Pill tone={passwordSaved ? "ok" : "mute"}>
              {passwordSaved ? tr("Password Saved") : tr("No Password Yet")}
            </Pill>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tr("From Address")}>
              <Input
                type="email"
                autoComplete="off"
                placeholder="support@company.com"
                value={form.from_address}
                disabled={loading || !editable}
                aria-invalid={fieldErrors.from_address ? true : undefined}
                onChange={(e) => set("from_address", e.target.value)}
              />
            </Field>
            <Field label={tr("Display Name")}>
              <Input
                autoComplete="off"
                placeholder={tr("Company name")}
                value={form.from_name}
                disabled={loading || !editable}
                onChange={(e) => set("from_name", e.target.value)}
              />
            </Field>
            <Field label={tr("SMTP Server")}>
              <Input
                autoComplete="off"
                placeholder="smtppro.zoho.com"
                value={form.smtp_host}
                disabled={loading || !editable}
                aria-invalid={fieldErrors.smtp_host ? true : undefined}
                onChange={(e) => set("smtp_host", e.target.value)}
              />
            </Field>
            <Field label={tr("Port")}>
              <Input
                inputMode="numeric"
                autoComplete="off"
                placeholder="465"
                value={form.smtp_port}
                disabled={loading || !editable}
                aria-invalid={fieldErrors.smtp_port ? true : undefined}
                onChange={(e) => set("smtp_port", e.target.value.replace(/[^0-9]/g, ""))}
              />
            </Field>
            <Field label={tr("User Name")}>
              <Input
                autoComplete="off"
                placeholder={form.from_address || "support@company.com"}
                value={form.smtp_user}
                disabled={loading || !editable}
                onChange={(e) => set("smtp_user", e.target.value)}
              />
            </Field>
            <Field label={tr("Password")}>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={passwordSaved ? tr("Saved, type to replace") : ""}
                value={password}
                disabled={loading || !editable}
                onChange={(e) => {
                  setNotice(null);
                  setPassword(e.target.value);
                }}
              />
            </Field>
          </div>
          {Object.entries(fieldErrors).filter(([k, v]) => v && k !== "inbox" && k !== "site_key").map(([k, v]) => (
            <p key={k} className="mt-2 text-sm text-[var(--bad)]">{v}</p>
          ))}
          {editable && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void saveDelivery()} disabled={busy !== null}>
                {busy === "delivery" ? tr("Saving…") : tr("Save")}
              </Button>
              <Button variant="outline" onClick={() => void sendTest()} disabled={busy !== null || !form.inbox}>
                {busy === "test" ? tr("Sending…") : tr("Send Test")}
              </Button>
            </div>
          )}
        </SettingsCard>

        <SettingsCard
          title={tr("Spam Check")}
          desc={tr(
            "Cloudflare Turnstile, on the message button, the contact form, the quote request and job applications. Create a widget for the website's domain in Cloudflare and enter its two keys here. Without them the forms rely on hidden fields and timing alone.",
          )}
          action={
            <Pill tone={secretIsSaved && siteKey ? "ok" : "mute"}>
              {secretIsSaved && siteKey ? tr("On") : tr("Off")}
            </Pill>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tr("Site Key")}>
              <Input
                autoComplete="off"
                placeholder="0x4AAAAAAA…"
                value={siteKey}
                disabled={loading || !editable}
                onChange={(e) => {
                  setNotice(null);
                  setSiteKey(e.target.value);
                }}
              />
            </Field>
            <Field label={tr("Secret Key")}>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={secretIsSaved ? tr("Saved, type to replace") : ""}
                value={secret}
                disabled={loading || !editable}
                onChange={(e) => {
                  setNotice(null);
                  setSecret(e.target.value);
                }}
              />
            </Field>
          </div>
          {editable && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void saveTurnstile()} disabled={busy !== null}>
                {busy === "turnstile" ? tr("Saving…") : tr("Save")}
              </Button>
              <Button variant="outline" onClick={() => void testTurnstile()} disabled={busy !== null || !secretIsSaved}>
                {busy === "turnstile-test" ? tr("Checking…") : tr("Test Secret Key")}
              </Button>
            </div>
          )}
        </SettingsCard>
      </div>
    </>
  );
}

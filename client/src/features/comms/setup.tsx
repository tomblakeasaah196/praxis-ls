/**
 * Comms → Setup — messaging keys & channels. PER-SECTION sender identities
 * (Billing / Documents / Notifications / Support) each with their own From
 * address + SMTP; the shared SMTP login; and the WhatsApp / Instagram API keys.
 * Secrets are write-only (blank keeps current). Kit-styled; accents → --primary.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/mail-api";

const PURPOSES: { key: string; label: string; blurb: string }[] = [
  { key: "BILLING", label: "Billing", blurb: "Invoices, receipts, statements" },
  { key: "DOCUMENTS", label: "Documents", blurb: "BLs, delivery notes, doc links" },
  { key: "NOTIFICATIONS", label: "Notifications", blurb: "Alerts & reminders" },
  { key: "SUPPORT", label: "Support", blurb: "Customer support replies" },
];

/* one per-section sender card (create or edit that section's mailbox) */
function SectionCard({ purpose, label, blurb, existing, onSaved }: { purpose: string; label: string; blurb: string; existing?: api.Sender; onSaved: () => void }) {
  const [f, setF] = React.useState({
    from_address: existing?.from_address || "", from_name: existing?.from_name || "", reply_to: existing?.reply_to || "",
    smtp_host: existing?.smtp_host || "", smtp_port: existing?.smtp_port != null ? String(existing.smtp_port) : "",
    is_active: existing?.is_active ?? true,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setDone(false);
    try {
      await api.upsertSender({
        purpose, from_address: f.from_address, from_name: f.from_name, reply_to: f.reply_to || undefined,
        smtp_host: f.smtp_host || undefined, smtp_port: f.smtp_port === "" ? undefined : Number(f.smtp_port), is_active: f.is_active,
      });
      setDone(true); onSaved();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-semibold">{label}</h3>
          <p className="micro">{blurb}</p>
        </div>
        <Pill tone={existing ? (existing.is_active ? "ok" : "mute") : "warn"}>{existing ? (existing.is_active ? "Active" : "Off") : "Not set"}</Pill>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From address" required><Input value={f.from_address} onChange={(e) => set("from_address", e.target.value)} placeholder={`${purpose.toLowerCase()}@yourco.cm`} /></Field>
        <Field label="From name" required><Input value={f.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder={`YourCo ${label}`} /></Field>
        <Field label="Reply-to"><Input value={f.reply_to} onChange={(e) => set("reply_to", e.target.value)} placeholder="optional" /></Field>
        <div />
        <Field label="SMTP host"><Input value={f.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.provider.com" /></Field>
        <Field label="SMTP port"><Input type="number" className="num" value={f.smtp_port} onChange={(e) => set("smtp_port", e.target.value)} placeholder="587" /></Field>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> Active</label>
        <div className="flex items-center gap-3">
          {done && <span className="micro text-[rgb(var(--ok))]">✓ Saved</span>}
          <Button type="submit" size="sm" loading={busy} disabled={busy || !f.from_address || !f.from_name}>Save</Button>
        </div>
      </div>
      {error && <div className="mt-2"><ErrorState message={error} /></div>}
    </form>
  );
}

/* write-only secret card (shared SMTP creds, channel tokens) */
function SecretCard({ title, description, fields, onSave }: { title: string; description: string; fields: { key: string; label: string; type?: string; placeholder?: string }[]; onSave: (v: Record<string, string>) => Promise<void> }) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setDone(false);
    try { await onSave(v); setDone(true); setV({}); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="micro mb-3">{description}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((fd) => (
          <Field key={fd.key} label={fd.label}>
            <Input type={fd.type || "text"} value={v[fd.key] || ""} onChange={(e) => setV((s) => ({ ...s, [fd.key]: e.target.value }))} placeholder={fd.placeholder || "•••••• (leave blank to keep)"} />
          </Field>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorState message={error} /></div>}
      <div className="mt-3 flex items-center justify-end gap-3">
        {done && <span className="micro text-[rgb(var(--ok))]">✓ Saved</span>}
        <Button type="submit" size="sm" loading={busy} disabled={busy || Object.values(v).every((x) => !x)}>Save</Button>
      </div>
    </form>
  );
}

export function SetupPage() {
  const senders = useResource(() => api.listSenders(), []);
  const navigate = useNavigate();
  const byPurpose = React.useMemo(() => {
    const m: Record<string, api.Sender> = {};
    (senders.data || []).forEach((s) => { if (!m[s.purpose]) m[s.purpose] = s; });
    return m;
  }, [senders.data]);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="micro uppercase tracking-wide">Comms</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Setup &amp; channels</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Per-section email senders, shared credentials, and the WhatsApp / Instagram APIs.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/comms")}>← Back to inbox</Button>
      </div>

      <h2 className="mb-2 font-display text-lg font-semibold">Section senders</h2>
      <p className="micro mb-3">Each section mails from its own verified address. Set the From identity and (optionally) a dedicated SMTP host.</p>
      {senders.error && <ErrorState message={errMsg(senders.error)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {PURPOSES.map((p) => (
          <SectionCard key={p.key + (byPurpose[p.key]?.email_identity_id || "")} purpose={p.key} label={p.label} blurb={p.blurb} existing={byPurpose[p.key]} onSaved={senders.reload} />
        ))}
      </div>

      <h2 className="mb-2 mt-8 font-display text-lg font-semibold">Credentials &amp; channels</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <SecretCard
          title="Shared SMTP login"
          description="Used by all section senders that don't set their own (write-only)."
          fields={[{ key: "smtp_user", label: "SMTP user" }, { key: "smtp_pass", label: "SMTP password", type: "password" }]}
          onSave={async (val) => { if (val.smtp_user) await api.putSetting("email", "smtp_user", val.smtp_user); if (val.smtp_pass) await api.putSetting("email", "smtp_pass", val.smtp_pass); }}
        />
        <SecretCard
          title="WhatsApp Business API"
          description="Cloud API token, phone-number ID and inbound webhook token."
          fields={[{ key: "token", label: "Access token", type: "password" }, { key: "phone_id", label: "Phone number ID" }, { key: "webhook_secret", label: "Webhook verify token", type: "password" }]}
          onSave={async (val) => { await api.putSetting("messaging", "whatsapp", val); }}
        />
        <SecretCard
          title="Instagram / Meta"
          description="Instagram Graph API access token for DMs."
          fields={[{ key: "token", label: "Access token", type: "password" }, { key: "ig_account_id", label: "IG account ID" }]}
          onSave={async (val) => { await api.putSetting("messaging", "instagram", val); }}
        />
      </div>
    </section>
  );
}

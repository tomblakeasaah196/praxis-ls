/**
 * A client's portal, managed from the client's own record (Client 360 → Portal).
 *
 *   PEOPLE       who at the client can sign in, what each of them sees
 *                (Everything / Shipments & documents / Billing), who manages
 *                their team, until when — and the invitation each is waiting
 *                on. Invite, resend, change and remove all happen here; the
 *                Settings → Portal access screen keeps investors and auditors.
 *   ONBOARDING   the client's checklist, ticked off as each step completes.
 *                The steps themselves are the tenant's, set once for every
 *                client in ⚙ Settings on the Clients list.
 *
 * Built for the hand first. On a phone the 360 is already a full-screen sheet,
 * so every row here is a single full-width tap target (≥ 56px) that opens its
 * own bottom sheet — the list reads like a settings screen, not a table with
 * buttons squeezed into it. On a desktop the same rows sit in two columns and
 * the sheets open as centred dialogs; nothing is desktop-only or phone-only.
 *
 * Gated on MOD-29 (the client portal) server-side; the tab hides for anyone
 * who cannot read it. The API is the authority for create/edit.
 */
import * as React from "react";
import { tr, tv, currentLocale } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, isFeatureDisabled, useResource } from "@/lib/use-resource";
import { dateFmt, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Checkbox, RadioGroup } from "@/components/ui/checkbox";
import { Pill, type Tone } from "@/components/ui/pill";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { CheckIcon, ChevronIcon, MailIcon, PlusIcon, ShieldIcon } from "@/components/ui/icons";
import { SCOPE_LABEL, type PortalScope } from "./portal-scope";

/* ── shapes (portal_client.controller staffPeople / peopleWithLogins) ───── */

export type SignIn = "ACTIVE" | "INVITED" | "INVITE_EXPIRED" | "NOT_INVITED" | "DISABLED";

export type PortalPerson = {
  portal_access_id: string;
  email: string;
  client_id: string;
  access_scope: PortalScope;
  is_client_admin: boolean;
  invited_by_email: string | null;
  created_at: string;
  expires_at: string | null;
  full_name: string | null;
  last_login_at: string | null;
  sign_in: SignIn;
  invited_at: string | null;
  invite_expires_at: string | null;
};

export type InviteDefaults = { access_scope: PortalScope; first_is_admin: boolean };
type People = { members: PortalPerson[]; defaults: InviteDefaults };
type Added = PortalPerson & { invite: { sent: boolean; emailed: boolean } };

/** A contact on the client's record, offered as a one-tap invite. */
export type ContactSuggestion = { name: string; email: string };

const SCOPES: PortalScope[] = ["ALL", "OPERATIONS", "BILLING"];
const SCOPE_HINT: Record<PortalScope, string> = {
  ALL: "Shipments, documents, invoices and payments",
  OPERATIONS: "Shipments and their documents — no invoices",
  BILLING: "Invoices and payments only",
};
const SIGN_IN_TONE: Record<SignIn, Tone> = {
  ACTIVE: "ok",
  INVITED: "blue",
  INVITE_EXPIRED: "warn",
  NOT_INVITED: "mute",
  DISABLED: "bad",
};
const SIGN_IN_LABEL: Record<SignIn, string> = {
  ACTIVE: "Can sign in",
  INVITED: "Invitation sent",
  INVITE_EXPIRED: "Invitation expired",
  NOT_INVITED: "Not invited yet",
  DISABLED: "Sign-in switched off",
};

/** The stored end is the last instant of a day; the form edits the day. */
const dayOf = (ts: string | null) => (ts ? String(ts).slice(0, 10) : "");
const ended = (p: PortalPerson) => !!p.expires_at && Date.parse(p.expires_at) < Date.now();
const displayName = (p: PortalPerson) => p.full_name || p.email;

const peoplePath = (clientId: string) => `/portal/clients/${encodeURIComponent(clientId)}/people`;

/** A full-width tap target for a list row — the one row recipe for this tab. */
const ROW =
  "flex w-full min-h-[56px] items-center gap-3 px-3 py-2.5 text-left transition-colors " +
  "hover:bg-accent/60 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " +
  "disabled:cursor-default disabled:opacity-60";

/** A section heading with its count and one action — the same shape on every section of the tab. */
export function PortalSectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ── people ─────────────────────────────────────────────────────────────── */

export function ClientPortalPeople({
  clientId,
  contacts = [],
}: {
  clientId: string;
  contacts?: ContactSuggestion[];
}) {
  const people = useResource(() => tenant<People>(peoplePath(clientId)), [clientId], { fresh: true });
  const [inviting, setInviting] = React.useState(false);
  const [open, setOpen] = React.useState<PortalPerson | null>(null);

  const members = people.data?.members ?? [];
  const defaults = people.data?.defaults ?? { access_scope: "ALL", first_is_admin: true };
  const taken = new Set(members.map((m) => m.email.toLowerCase()));
  const suggestions = contacts.filter((c) => c.email && !taken.has(c.email.toLowerCase()));

  if (isFeatureDisabled(people.errorCode)) {
    return (
      <section>
        <PortalSectionHeader title={tr("Who can sign in")} />
        <EmptyState
          title={tr("The client portal is not switched on")}
          hint={tr("It is part of the plan your administrator manages. Once it is on, you give access from here.")}
        />
      </section>
    );
  }

  const inviteButton = (
    <Button size="sm" icon={<PlusIcon width={16} height={16} />} onClick={() => setInviting(true)}>
      {tr("Invite")}
    </Button>
  );

  return (
    <section className="min-w-0">
      <PortalSectionHeader
        title={tr("Who can sign in")}
        meta={people.data ? tv("{{n}} with access", { n: members.length }) : undefined}
        action={people.data ? inviteButton : undefined}
      />
      {people.error ? (
        <ErrorState message={people.error} />
      ) : !people.data ? (
        <SkeletonTable />
      ) : members.length === 0 ? (
        <EmptyState
          title={tr("Nobody at this client can sign in yet")}
          hint={tr("Invite their main contact. They get an email to set a password, and can then add their own colleagues.")}
          action={
            <Button icon={<PlusIcon width={16} height={16} />} onClick={() => setInviting(true)}>
              {tr("Invite someone")}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {members.map((p) => (
            <li key={p.portal_access_id}>
              <button type="button" className={ROW} onClick={() => setOpen(p)} aria-label={tv("Manage {{name}}", { name: displayName(p) })}>
                <Avatar name={p.full_name || p.email} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{displayName(p)}</span>
                  {p.full_name ? <span className="block truncate text-xs text-muted-foreground">{p.email}</span> : null}
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill tone="blue">{tr(SCOPE_LABEL[p.access_scope])}</Pill>
                    {p.is_client_admin ? (
                      <Pill tone="ok">
                        <ShieldIcon width={12} height={12} aria-hidden />
                        {tr("Admin")}
                      </Pill>
                    ) : null}
                    {p.sign_in !== "ACTIVE" ? <Pill tone={SIGN_IN_TONE[p.sign_in]}>{tr(SIGN_IN_LABEL[p.sign_in])}</Pill> : null}
                    {p.expires_at ? (
                      <Pill tone={ended(p) ? "bad" : "mute"}>
                        {ended(p) ? tr("Access ended") : tv("Until {{date}}", { date: dateFmt(p.expires_at) })}
                      </Pill>
                    ) : null}
                  </span>
                </span>
                <ChevronIcon className="-rotate-90 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <InviteSheet
        open={inviting}
        clientId={clientId}
        defaults={defaults}
        firstPerson={members.length === 0}
        suggestions={suggestions}
        onClose={() => setInviting(false)}
        onDone={people.reload}
      />
      <PersonSheet
        person={open}
        clientId={clientId}
        onClose={() => setOpen(null)}
        onChanged={(next) => {
          people.reload();
          setOpen(next);
        }}
      />
    </section>
  );
}

function ScopeChoice({ value, onChange }: { value: PortalScope; onChange: (s: PortalScope) => void }) {
  return (
    <RadioGroup
      aria-label={tr("What they see")}
      value={value}
      onValueChange={(v) => onChange(v as PortalScope)}
      options={SCOPES.map((s) => ({ value: s, label: tr(SCOPE_LABEL[s]), hint: tr(SCOPE_HINT[s]) }))}
      className="rounded-xl border bg-card p-3"
    />
  );
}

function InviteSheet({
  open,
  clientId,
  defaults,
  firstPerson,
  suggestions,
  onClose,
  onDone,
}: {
  open: boolean;
  clientId: string;
  defaults: InviteDefaults;
  firstPerson: boolean;
  suggestions: ContactSuggestion[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<PortalScope>(defaults.access_scope);
  const [admin, setAdmin] = React.useState(false);
  const [until, setUntil] = React.useState("");
  const [send, setSend] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setName("");
    setScope(defaults.access_scope);
    // The tenant's rule, shown rather than applied behind the person's back:
    // the box starts ticked for a client's first person when that is the
    // setting, and they can untick it.
    setAdmin(firstPerson && defaults.first_is_admin);
    setUntil("");
    setSend(true);
    setError(null);
  }, [open, defaults.access_scope, defaults.first_is_admin, firstPerson]);

  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) {
      setError(tr("Enter their email address."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await tenant<Added>(peoplePath(clientId), {
        method: "POST",
        body: {
          email: email.trim(),
          ...(name.trim() ? { full_name: name.trim() } : {}),
          access_scope: scope,
          is_client_admin: admin,
          expires_at: until || null,
          send_invite: send,
        },
      });
      onDone();
      onClose();
      if (!send) toast.success(tv("{{email}} has access. Send the invitation when you are ready.", { email: r.email }));
      else if (r.invite.emailed) toast.success(tv("Invitation sent to {{email}}.", { email: r.email }));
      // The grant stands either way — the row offers Resend, and saying so is
      // what stops "I invited them" from being quietly untrue.
      else toast.error(tv("{{email}} has access, but the email could not be sent. Open them and resend it.", { email: r.email }));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Invite to the client portal")}
      description={tr("They sign in to follow their shipments, send documents and see their invoices.")}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            {tr("Cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={!valid}
            icon={send ? <MailIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
            onClick={() => void submit()}
            className="w-full sm:w-auto"
          >
            {send ? tr("Send invitation") : tr("Give access")}
          </Button>
        </div>
      }
    >
      <form className="grid grid-cols-1 gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {suggestions.length ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{tr("From this client's contacts")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 6).map((s) => {
                const on = email.trim().toLowerCase() === s.email.toLowerCase();
                return (
                  <button
                    key={s.email}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setEmail(s.email);
                      setName(s.name);
                    }}
                    className={cn(
                      "min-h-9 max-w-full truncate rounded-full border px-3 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-primary/10 text-primary-ink" : "bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    {s.name || s.email}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <Field label={tr("Email")} required error={error ?? undefined}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </Field>
        <Field label={tr("Name")} hint={tr("Optional — used to greet them in the email.")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} />
        </Field>
        <Field label={tr("What they see")}>
          <ScopeChoice value={scope} onChange={setScope} />
        </Field>
        <Checkbox
          checked={admin}
          onCheckedChange={setAdmin}
          label={tr("Portal admin")}
          hint={tr("Can invite and manage their colleagues from the portal.")}
        />
        <Field label={tr("Last day of access")} hint={tr("Leave empty for no end date.")}>
          <DateField value={until} onChange={setUntil} min={todayISO()} />
        </Field>
        <Checkbox
          checked={send}
          onCheckedChange={setSend}
          label={tr("Email them the invitation now")}
          hint={tr("A link to set their own password. It stays valid for 7 days.")}
        />
      </form>
    </Modal>
  );
}

function signInLine(p: PortalPerson): string {
  switch (p.sign_in) {
    case "ACTIVE":
      return p.last_login_at ? tv("Last signed in {{date}}.", { date: dateFmt(p.last_login_at) }) : tr("They have set their password.");
    case "INVITED":
      return p.invite_expires_at
        ? tv("Invitation sent {{sent}} — the link works until {{until}}.", { sent: dateFmt(p.invited_at), until: dateFmt(p.invite_expires_at) })
        : tr("Invitation sent.");
    case "INVITE_EXPIRED":
      return tr("Their invitation expired before they used it. Send a new one.");
    case "DISABLED":
      return tr("Their sign-in is switched off. Sending an invitation switches it back on.");
    default:
      return tr("They have access but no invitation yet — they cannot sign in until you send one.");
  }
}

function PersonSheet({
  person,
  clientId,
  onClose,
  onChanged,
}: {
  person: PortalPerson | null;
  clientId: string;
  onClose: () => void;
  onChanged: (next: PortalPerson | null) => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [scope, setScope] = React.useState<PortalScope>("ALL");
  const [admin, setAdmin] = React.useState(false);
  const [until, setUntil] = React.useState("");
  const [busy, setBusy] = React.useState<"save" | "resend" | "remove" | null>(null);

  React.useEffect(() => {
    if (!person) return;
    setScope(person.access_scope);
    setAdmin(person.is_client_admin);
    setUntil(dayOf(person.expires_at));
  }, [person]);

  if (!person) return confirmDialog;
  const p = person;
  const base = `${peoplePath(clientId)}/${encodeURIComponent(p.portal_access_id)}`;
  const dirty = scope !== p.access_scope || admin !== p.is_client_admin || until !== dayOf(p.expires_at);

  async function save() {
    setBusy("save");
    try {
      await tenant<PortalPerson>(base, {
        method: "POST",
        body: { access_scope: scope, is_client_admin: admin, expires_at: until || null },
      });
      toast.success(tr("Access updated."));
      onChanged(null);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    setBusy("resend");
    try {
      const next = await tenant<Added>(`${base}/invite`, { method: "POST" });
      if (next.invite.emailed) toast.success(tv("Invitation sent to {{email}}.", { email: p.email }));
      else toast.error(tr("The link is ready but the email could not be sent. Try again in a moment."));
      onChanged(next);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: tv("Remove {{name}}'s access?", { name: displayName(p) }),
      body: tr("They can no longer see this client's shipments, documents or invoices. You can invite them again later."),
      confirmLabel: tr("Remove access"),
      destructive: true,
    });
    if (!ok) return;
    setBusy("remove");
    try {
      await tenant(`${base}/revoke`, { method: "POST" });
      toast.success(tv("{{name}} no longer has access.", { name: displayName(p) }));
      onChanged(null);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const canInvite = p.sign_in !== "ACTIVE";
  return (
    <>
      <Modal
        open={!!person}
        onClose={onClose}
        title={displayName(p)}
        description={p.full_name ? p.email : undefined}
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              loading={busy === "remove"}
              disabled={busy !== null && busy !== "remove"}
              onClick={() => void remove()}
              className="w-full text-destructive sm:w-auto"
            >
              {tr("Remove access")}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
                {tr("Close")}
              </Button>
              <Button loading={busy === "save"} disabled={!dirty || (busy !== null && busy !== "save")} onClick={() => void save()} className="w-full sm:w-auto">
                {tr("Save")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <div className="flex items-start gap-3 rounded-xl bg-muted p-3">
            <Pill tone={SIGN_IN_TONE[p.sign_in]}>{tr(SIGN_IN_LABEL[p.sign_in])}</Pill>
            <p className="min-w-0 flex-1 text-sm text-foreground">{signInLine(p)}</p>
          </div>
          {canInvite ? (
            <Button
              variant="outline"
              loading={busy === "resend"}
              disabled={busy !== null && busy !== "resend"}
              icon={<MailIcon width={16} height={16} />}
              onClick={() => void resend()}
              className="w-full sm:w-auto sm:justify-self-start"
            >
              {p.sign_in === "INVITED" ? tr("Resend invitation") : tr("Send invitation")}
            </Button>
          ) : null}
          <Field label={tr("What they see")}>
            <ScopeChoice value={scope} onChange={setScope} />
          </Field>
          <Checkbox
            checked={admin}
            onCheckedChange={setAdmin}
            label={tr("Portal admin")}
            hint={tr("Can invite and manage their colleagues from the portal.")}
          />
          <Field label={tr("Last day of access")} hint={tr("Leave empty for no end date.")}>
            <div className="flex items-center gap-2">
              <DateField value={until} onChange={setUntil} className="min-w-0 flex-1" />
              {until ? (
                <Button variant="ghost" size="sm" icon={null} onClick={() => setUntil("")}>
                  {tr("No end date")}
                </Button>
              ) : null}
            </div>
          </Field>
          <p className="break-words text-xs text-muted-foreground">
            {[
              // The sheet's title truncates a long address; the full one is here.
              p.full_name ? null : p.email,
              tv("Access given {{date}}", { date: dateFmt(p.created_at) }),
              p.invited_by_email ? tv("added by {{who}} from the portal", { who: p.invited_by_email }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}

/* ── onboarding ─────────────────────────────────────────────────────────── */

type Step = {
  step_key: string;
  label_en: string;
  label_fr: string;
  done: boolean;
  done_at: string | null;
};
type Onboarding = { client_id: string; progress: number; steps: Step[] };

export function ClientOnboarding({ clientId }: { clientId: string }) {
  const toast = useToast();
  const path = `/portal/clients/${encodeURIComponent(clientId)}/onboarding`;
  const onb = useResource(() => tenant<Onboarding>(path), [clientId], { fresh: true });
  // Optimistic ticks: a checklist that waits a round trip before the box fills
  // reads as broken on a phone. The server's answer replaces them on reload.
  const [local, setLocal] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const fr = currentLocale().startsWith("fr");

  React.useEffect(() => setLocal({}), [onb.data]);

  if (isFeatureDisabled(onb.errorCode)) return null;

  const steps = (onb.data?.steps ?? []).map((s) => ({ ...s, done: local[s.step_key] ?? s.done }));
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  async function toggle(s: Step) {
    setBusy(s.step_key);
    setLocal((m) => ({ ...m, [s.step_key]: !s.done }));
    try {
      await tenant(`${path}/${encodeURIComponent(s.step_key)}`, { method: "POST" });
      onb.reload();
    } catch (e) {
      setLocal((m) => {
        const next = { ...m };
        delete next[s.step_key];
        return next;
      });
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="min-w-0">
      <PortalSectionHeader
        title={tr("Onboarding")}
        meta={onb.data ? tv("{{done}} of {{total}} done", { done, total: steps.length }) : undefined}
      />
      {onb.error ? (
        <ErrorState message={onb.error} />
      ) : !onb.data ? (
        <SkeletonTable />
      ) : steps.length === 0 ? (
        <EmptyState
          title={tr("No onboarding steps")}
          hint={tr("Add the steps every client goes through in ⚙ Settings on the Clients list.")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="px-3 pb-2 pt-3">
            <div
              role="progressbar"
              aria-label={tr("Onboarding progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-right text-xs font-medium text-muted-foreground">{pct}%</p>
          </div>
          <ul className="divide-y border-t">
            {steps.map((s) => (
              <li key={s.step_key}>
                <button
                  type="button"
                  className={ROW}
                  aria-pressed={s.done}
                  disabled={busy === s.step_key}
                  onClick={() => void toggle(s)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
                      s.done ? "border-ok bg-ok text-background" : "border-input bg-background",
                    )}
                  >
                    {s.done ? <CheckIcon width={14} height={14} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", s.done ? "text-muted-foreground" : "font-medium text-foreground")}>
                      {fr ? s.label_fr || s.label_en : s.label_en || s.label_fr}
                    </span>
                    {s.done && s.done_at ? (
                      <span className="block text-xs text-muted-foreground">{tv("Done {{date}}", { date: dateFmt(s.done_at) })}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {steps.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr("The client sees this checklist in their portal. The steps are the same for every client — change them in ⚙ Settings on the Clients list.")}
        </p>
      ) : null}
    </section>
  );
}

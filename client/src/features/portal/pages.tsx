/**
 * Portal access — the INVESTOR and AUDITOR portals: grant and revoke their
 * read-access, and preview the exact scope each grantee would see. The
 * external data views are feature-gated (portal.investor / portal.audit);
 * previews degrade gracefully when a flag is off.
 *
 * The CLIENT portal is not managed here any more. Who at a client can sign in
 * is part of the client — Client 360 → Portal, under the client portal's own
 * grant (MOD-29) — so this screen lists which clients have portal users and
 * links to each one rather than offering a second place to change them.
 * Investors and auditors stay here, on the IAM grant (MOD-67): they open the
 * tenant's own books, not one client's shipments.
 *
 * Shared primitives from components/ui/*; AI panel gated globally.
 */
import { pageShell } from "@/lib/layout";
import { tr, tv } from "@/lib/i18n";
import * as React from "react";
import { Link } from "react-router-dom";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Checkbox, RadioGroup } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { Callout } from "@/components/ui/callout";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { ChevronIcon } from "@/components/ui/icons";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt, todayISO } from "@/lib/format";
import { DataView } from "@/components/ui/data-view";

const PORTAL_AI: AiAction[] = [
  {
    label: "Review access",
    kind: "read",
    describe:
      "Summarise who currently has investor or auditor portal access and when grants expire.",
  },
];

type ExternalPortal = "INVESTOR" | "AUDITOR";
const PORTAL_LABEL: Record<ExternalPortal, string> = { INVESTOR: "Investor", AUDITOR: "Auditor" };
const PORTAL_HINT: Record<ExternalPortal, string> = {
  INVESTOR: "Board view — key figures and financial statements",
  AUDITOR: "Read-only records, the ledger trail and the data room",
};

const clientPortalHref = (clientId: string) =>
  `/master/clients?focus=${encodeURIComponent(clientId)}&tab=Portal`;

function GrantModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [portal, setPortal] = React.useState<ExternalPortal>("AUDITOR");
  const [email, setEmail] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [invite, setInvite] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPortal("AUDITOR");
    setEmail("");
    setExpiresAt("");
    setInvite(true);
    setError(null);
    setNotice(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/portals/access", {
        method: "POST",
        body: {
          portal,
          subject_email: email.trim(),
          // The LAST day of access, kept to its end rather than its first instant.
          expires_at: expiresAt ? `${expiresAt}T23:59:59.999Z` : undefined,
        },
      });

      // Create the LOGIN as well, not just the grant: `portal_access` is keyed
      // by email while the credentials live in `portal_user`, so a grant on its
      // own lets nobody in. A SEPARATE, non-fatal step — the grant must not be
      // rolled back because an SMTP server was down; the row offers Resend.
      let problem: string | null = null;
      if (invite) {
        try {
          const r = await tenant<{ emailed: boolean }>("/portal/users/invite", {
            method: "POST",
            body: { email: email.trim() },
          });
          if (!r.emailed)
            problem = tr("Access granted, but the invitation email could not be sent. Use Resend on the row.");
        } catch (e) {
          problem = tv("Access granted, but the invitation could not be sent ({{why}}). Use Resend on the row.", { why: errMsg(e) });
        }
      }
      onSaved();
      // Held open on a problem so the message is actually read.
      setNotice(problem);
      if (!problem) onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Grant portal access")}
      description={tr("Give an investor or an auditor a scoped, read-only view.")}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={onClose} disabled={busy} className="w-full sm:w-auto">
            {notice ? tr("Close") : tr("Cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!email.trim() || busy} className="w-full sm:w-auto">
            {tr("Grant access")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label={tr("Portal")} required>
          <RadioGroup
            aria-label={tr("Portal")}
            value={portal}
            onValueChange={(v) => setPortal(v as ExternalPortal)}
            options={(["AUDITOR", "INVESTOR"] as const).map((p) => ({
              value: p,
              label: tr(PORTAL_LABEL[p]),
              hint: tr(PORTAL_HINT[p]),
            }))}
            className="rounded-xl border bg-card p-3"
          />
        </Field>
        <Field label={tr("Email")} required>
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cfo@acme.cm"
          />
        </Field>
        <Field label={tr("Last day of access")} hint={tr("Optional — recommended for auditors.")}>
          <DateField value={expiresAt} onChange={setExpiresAt} min={todayISO()} />
        </Field>
        <Checkbox
          checked={invite}
          onCheckedChange={setInvite}
          label={tr("Email them a link to set a password")}
          hint={tr("Without a sign-in, a grant alone doesn't let anyone in. Leave this on unless they already have one.")}
        />
        <Callout tone="info">
          {tr("Client portal users are invited from the client's own record: Clients → the client → Portal.")}
        </Callout>
        {error && <ErrorState message={error} />}
        {notice && <Callout tone="warn">{notice}</Callout>}
      </div>
    </Modal>
  );
}

function PreviewModal({
  open,
  title,
  path,
  onClose,
}: {
  open: boolean;
  title: string;
  path: string;
  onClose: () => void;
}) {
  const [data, setData] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !path) return;
    let live = true;
    setData(undefined);
    setError(null);
    tenant<unknown>(path)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [open, path]);

  const gated =
    error && /feature|not enabled|disabled|forbidden|permission/i.test(error);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={tr("Exactly what this grantee would see.")}
      size="xl"
      footer={
        <Button variant="outline" onClick={onClose}>
          {tr("Close")}
        </Button>
      }
    >
      {error ? (
        gated ? (
          <EmptyState
            title={tr("This portal view isn't enabled")}
            hint={tr("The portal feature for this view is off. Enable it to preview the external scope.")}
          />
        ) : (
          <ErrorState message={error} />
        )
      ) : data === undefined ? (
        <LoadingRow label={tr("Loading scope…")} />
      ) : (
        <DataView
          data={data}
          emptyTitle={tr("This grantee would see nothing here")}
          emptyHint={tr("The scope resolves to no records — check the grant's date range.")}
          className="max-h-96 overflow-auto"
        />
      )}
    </Modal>
  );
}

export function PortalAccessPage() {
  const reload = useRefresh();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const { rows, error } = useList("/portals/access");
  const { rows: clients } = useList("/clients");
  // Logins, so a grant can say whether the person can actually sign in. Matched
  // in the CLIENT rather than joined server-side: portal_access is per-environment
  // business data while portal_user is identity (live) data, and a cross-schema
  // join is exactly the trap that broke TEST-mode writes for fourteen sessions.
  const { rows: portalUsers } = useList("/portal/users");
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<{ title: string; path: string } | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);

  const clientName = React.useMemo(
    () => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])),
    [clients],
  );
  const loginByEmail = React.useMemo(
    () => new Map((portalUsers || []).map((u) => [String(u.email || "").toLowerCase(), u])),
    [portalUsers],
  );

  const external = (rows || []).filter((g) => g.portal !== "CLIENT");
  // Which clients have portal users — a count and a way in, never the controls.
  const clientCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const g of rows || []) {
      if (g.portal === "CLIENT" && g.client_id) m.set(String(g.client_id), (m.get(String(g.client_id)) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([id, n]) => ({ id, n, name: clientName.get(id) ?? tr("Client") }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, clientName]);

  /** Create-or-find the login and (re)send the set-password link. */
  async function invite(email: string) {
    setRowBusy(email);
    try {
      const r = await tenant<{ emailed: boolean; created: boolean }>("/portal/users/invite", {
        method: "POST",
        body: { email },
      });
      if (r.emailed) toast.success(tv("Invitation sent to {{email}}.", { email }));
      else toast.error(tv("Login ready for {{email}}, but the email could not be sent — check the mail settings and resend.", { email }));
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function revoke(g: Row) {
    const email = String(g.subject_email || "");
    const ok = await confirm({
      title: tv("Remove {{name}}'s access?", { name: email }),
      body: tr("They can no longer open this portal. You can grant access again later."),
      confirmLabel: tr("Remove access"),
      destructive: true,
    });
    if (!ok) return;
    const id = String(g.portal_access_id);
    setRowBusy(id);
    try {
      await tenant(`/portals/access/${id}/revoke`, { method: "POST", body: {} });
      toast.success(tv("{{name}} no longer has access.", { name: email }));
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Portal access")}
        description={tr("Investors and auditors: who can open their portal, and until when. Client portal users are managed on each client.")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setPreview({ title: tr("Investor portal preview"), path: "/portals/investor" })}>
              {tr("Preview investor")}
            </Button>
            <Button variant="outline" onClick={() => setPreview({ title: tr("Auditor portal preview"), path: "/portals/auditor" })}>
              {tr("Preview auditor")}
            </Button>
            <Button onClick={() => setGrantOpen(true)}>{tr("Grant access")}</Button>
          </div>
        }
      />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">{tr("Investors and auditors")}</h2>
            {external.length === 0 ? (
              <EmptyState
                title={tr("No investor or auditor has access")}
                hint={tr("Grant an auditor a time-boxed, read-only view, or an investor the board figures.")}
              />
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {external.map((g) => {
                  const id = String(g.portal_access_id);
                  const portal = String(g.portal) as ExternalPortal;
                  const email = String(g.subject_email || "").toLowerCase();
                  // A grant with no portal_user is a grant nobody can use —
                  // surfaced on the row because it is invisible otherwise.
                  const login = loginByEmail.get(email);
                  const signedInBefore = !!(login && login.last_login_at);
                  const expired = !!g.expires_at && Date.parse(String(g.expires_at)) < Date.now();
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{cell(g.subject_email)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Pill tone="blue">{tr(PORTAL_LABEL[portal] ?? portal)}</Pill>
                          {!login ? (
                            <Pill tone="warn">{tr("No sign-in yet")}</Pill>
                          ) : !signedInBefore ? (
                            <Pill tone="mute">{tr("Invitation sent")}</Pill>
                          ) : null}
                          {g.expires_at ? (
                            <Pill tone={expired ? "bad" : "mute"}>
                              {expired ? tr("Access ended") : tv("Until {{date}}", { date: dateFmt(g.expires_at) })}
                            </Pill>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {tv("Granted {{date}}", { date: dateFmt(g.created_at) })}
                          {signedInBefore ? ` · ${tv("last signed in {{date}}", { date: dateFmt(login?.last_login_at) })}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={login ? "ghost" : "outline"}
                          loading={rowBusy === email}
                          onClick={() => void invite(email)}
                        >
                          {login ? tr("Resend invite") : tr("Create sign-in")}
                        </Button>
                        <MoreMenu label={tv("Actions for {{name}}", { name: email })}>
                          <DropdownItem destructive disabled={rowBusy === id} onSelect={() => void revoke(g)}>
                            {tr("Remove access")}
                          </DropdownItem>
                        </MoreMenu>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">{tr("Client portals")}</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              {tr("Who at a client can sign in is managed on the client: open one to invite, change or remove people.")}
            </p>
            {clientCounts.length === 0 ? (
              <EmptyState
                title={tr("No client has portal users yet")}
                hint={tr("Open a client and use its Portal tab to invite their contact.")}
                action={
                  <Link to="/master/clients" className="text-sm font-medium text-primary-ink hover:underline">
                    {tr("Go to Clients")}
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {clientCounts.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={clientPortalHref(c.id)}
                      className="flex min-h-[48px] items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{c.name}</span>
                      <Pill tone="mute">{tv("{{n}} with access", { n: c.n })}</Pill>
                      <ChevronIcon className="-rotate-90 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <AiActions actions={PORTAL_AI} />

      <GrantModal open={grantOpen} onClose={() => setGrantOpen(false)} onSaved={reload} />
      <PreviewModal
        open={!!preview}
        title={preview?.title ?? ""}
        path={preview?.path ?? ""}
        onClose={() => setPreview(null)}
      />
      {confirmDialog}
    </section>
  );
}

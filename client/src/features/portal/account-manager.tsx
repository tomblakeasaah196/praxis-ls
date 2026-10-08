/**
 * A client's account manager (client portal PR 3, 14200): the person on the
 * team who looks after the client, and the first one their portal messages
 * reach — with the owners of the shipment a message is about.
 *
 * Chosen with the employee picker, limited to people who have a login
 * (`requireAccount`): an account manager is someone a message must be able to
 * reach, and the server refuses a login that is not active. The picker
 * searches `/clients/account-manager-candidates` rather than `/employees`: the
 * sales and operations people who assign account managers hold the Client
 * inbox, not the employee master. Someone who has
 * since left shows as unreachable, and until a new manager is named the
 * client's messages go to the Client inbox team instead — which this says, so
 * nobody assumes a client is looked after when nobody is being told.
 *
 * Shown on the client's own screen (Overview and Messages) and at the top of a
 * conversation in the Client inbox.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { useResource, errMsg } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { EmployeePicker, type EmployeeHit } from "@/components/employee-picker";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/cn";

export type AccountManager = {
  client_id: string;
  manager: {
    user_id: string;
    name: string | null;
    job_title: string | null;
    email: string | null;
    employee_id: string | null;
    reachable: boolean;
  } | null;
};

const path = (clientId: string) => `/clients/${encodeURIComponent(clientId)}/account-manager`;
const toldPath = (clientId: string) => `/clients/${encodeURIComponent(clientId)}/told`;
const CANDIDATES = "/clients/account-manager-candidates";

type ToldPerson = { user_id: string; name: string | null; job_title?: string | null; reachable?: boolean; employee_id?: string | null };

/**
 * Who is told about a client (tenant review 29 Sep 2026, D7): the account
 * manager, the CEO-role users and the "Also notify" people — in-app, by push
 * and by email, each person free to opt out in Preferences. When nobody
 * reachable looks after the client, the Client inbox team is told as well.
 */
export type ToldList = {
  client_id: string;
  manager: AccountManager["manager"];
  also_notify: ToldPerson[];
  ceo: ToldPerson[];
  fallback_to_inbox: boolean;
};

/** "Awa (account manager), Timothée (CEO), Paul (also notify)" — the whole list, one sentence. */
function toldSentence(t: ToldList | null): string {
  if (!t) return "";
  const named = (p: { name: string | null }) => p.name || tr("Unnamed");
  const parts: string[] = [];
  if (t.manager && t.manager.reachable) parts.push(`${named(t.manager)} (${tr("account manager")})`);
  for (const p of t.ceo || []) parts.push(`${named(p)} (${tr("CEO")})`);
  for (const p of t.also_notify || []) if (p.reachable !== false) parts.push(`${named(p)} (${tr("also notify")})`);
  if (t.fallback_to_inbox) parts.push(tr("the client inbox team"));
  return parts.join(", ");
}

export function AccountManagerCard({
  clientId,
  className,
  onChange,
}: {
  clientId: string;
  className?: string;
  /** Called after a change — the Client inbox refreshes who looks after whom. */
  onChange?: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const res = useResource(() => tenant<AccountManager>(path(clientId)), [clientId], { fresh: true });
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const m = res.data?.manager || null;
  // The whole "who is told" list, re-read whenever the manager changes.
  const told = useResource(() => tenant<ToldList>(toldPath(clientId)), [clientId, m?.user_id ?? null], { fresh: true });
  const [addingAlso, setAddingAlso] = React.useState(false);
  const also = (told.data && Array.isArray(told.data.also_notify) ? told.data.also_notify : []) as ToldPerson[];

  async function saveAlso(userIds: string[], message: string) {
    setBusy(true);
    try {
      await tenant<ToldList>(`/clients/${encodeURIComponent(clientId)}/also-notify`, { method: "PUT", body: { user_ids: userIds } });
      toast.success(message);
      setAddingAlso(false);
      told.reload();
      onChange?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(userId: string | null) {
    setBusy(true);
    try {
      await tenant<AccountManager>(path(clientId), { method: "PUT", body: { user_id: userId } });
      toast.success(userId ? tr("Account manager saved") : tr("Account manager removed"));
      setPicking(false);
      res.reload();
      onChange?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function pick(hit: EmployeeHit) {
    if (!hit.account_user_id) return;
    void save(hit.account_user_id);
  }

  async function remove() {
    const ok = await confirm({
      title: tr("Remove the account manager?"),
      body: tr("Until someone else is named, this client's messages go to the client inbox team."),
      confirmLabel: tr("Remove"),
      cancelLabel: tr("Keep"),
    });
    if (ok) void save(null);
  }

  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="micro">{tr("Account Manager")}</p>
          {res.loading ? (
            <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
          ) : res.error ? (
            <p className="text-sm text-[rgb(var(--bad))]">{res.error}</p>
          ) : m ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{m.name || m.email || tr("Unnamed")}</p>
              {m.job_title ? <span className="text-xs text-muted-foreground">{m.job_title}</span> : null}
              {!m.reachable ? <Pill tone="bad">{tr("No active login")}</Pill> : null}
            </div>
          ) : (
            /* Was "Nobody yet — messages go to the client inbox team". The
               first half is the STATE and belongs on screen; the second is what
               happens because of it, which matters once, to whoever is deciding
               whether to assign somebody. */
            <span className="flex items-center gap-1.5">
              <p className="text-sm text-muted-foreground">{tr("Nobody yet")}</p>
              <InfoHint label={tr("About having no account manager")}>
                {tr("Until someone is named, this client's messages go to the client inbox team.")}
              </InfoHint>
            </span>
          )}
        </div>
        {!res.loading && !res.error ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant={m ? "outline" : "default"} onClick={() => setPicking((v) => !v)} disabled={busy}>
              {m ? tr("Change") : tr("Assign")}
            </Button>
            {m ? (
              <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
                {tr("Remove")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {picking ? (
        <div className="mt-3">
          <EmployeePicker
            id={`account-manager-${clientId}`}
            label={tr("Choose the account manager")}
            placeholder={tr("Search by name or job title…")}
            requireAccount
            source="/clients/account-manager-candidates"
            disabled={busy}
            exclude={m?.employee_id ? new Set([m.employee_id]) : undefined}
            onPick={pick}
          />
          {/* Why somebody expected is missing from the list. Worth having,
              not worth a line under every search. */}
          <span className="mt-1 flex items-center gap-1.5">
            <p className="hint">{tr("People with a login only.")}</p>
            <InfoHint label={tr("About who can be an account manager")}>
              {tr("Only people with a login can be told when the client writes.")}
            </InfoHint>
          </span>
        </div>
      ) : null}

      {/* Also notify + the whole list (D7). */}
      {told.data && Array.isArray(told.data.also_notify) ? (
        <div className="mt-4 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="micro">{tr("Also Notify")}</p>
            <Button size="sm" variant="ghost" onClick={() => setAddingAlso((v) => !v)} disabled={busy}>
              {tr("Add a person")}
            </Button>
          </div>
          {also.length ? (
            <ul className="mt-1 flex flex-wrap gap-2" aria-label={tr("Also notify")}>
              {also.map((p) => (
                <li key={p.user_id} className="flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs text-foreground">
                  <span>{p.name || tr("Unnamed")}</span>
                  {p.reachable === false ? <Pill tone="bad">{tr("No active login")}</Pill> : null}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full px-1 text-muted-foreground hover:text-foreground"
                    aria-label={tv("Stop telling {{name}}", { name: p.name || tr("this person") })}
                    disabled={busy}
                    onClick={() =>
                      void saveAlso(
                        also.filter((x) => x.user_id !== p.user_id).map((x) => x.user_id),
                        tr("Removed from the list"),
                      )
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            /* The "Add a person" button is directly above this and already
               says what to do, so the instruction half was the button's label
               written out a second time. */
            <p className="hint">{tr("Nobody else.")}</p>
          )}
          {addingAlso ? (
            <div className="mt-2">
              <EmployeePicker
                id={`also-notify-${clientId}`}
                label={tr("Also notify")}
                placeholder={tr("Search by name or job title…")}
                requireAccount
                source={CANDIDATES}
                disabled={busy}
                exclude={new Set(also.map((p) => p.employee_id).filter((x): x is string => !!x))}
                onPick={(hit) => {
                  if (!hit.account_user_id) return;
                  void saveAlso([...also.map((x) => x.user_id), hit.account_user_id], tr("Added to the list"));
                }}
              />
            </div>
          ) : null}
          {/*
            The live list stays: who hears about this client is a fact about
            the data, it changes as people are added, and somebody assigning an
            account manager is checking exactly this. The delivery mechanics
            underneath it never change and were printed on every client in the
            tenant, so they moved to the ⓘ on the same line.
          */}
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{tr("Told about this client:")}</span>
            <span>{toldSentence(told.data) || tr("nobody")}</span>
            <InfoHint label={tr("About how people are told")}>
              {tr("In-app, by push and by email. Each person can switch the email off in their notification preferences.")}
            </InfoHint>
          </p>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}


/* ── picked at creation (D7) ────────────────────────────────────────── */

export type ToldPick = { manager: EmployeeHit | null; also: EmployeeHit[] };

/**
 * The account manager and "Also notify" pickers of the New client form — the
 * API already takes `relationship_manager_user_id` and `also_notify_user_ids`
 * on create, through the same audited service the 360 uses. People with a
 * login only, from the same candidates read.
 */
export function ClientToldFields({ value, onChange }: { value: ToldPick; onChange: (next: ToldPick) => void }) {
  const chosen = new Set([value.manager?.employee_id, ...value.also.map((p) => p.employee_id)].filter((x): x is string => !!x));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {tr("Account Manager")}
          <InfoHint label={tr("About the account manager")}>
            {tr("The first person told when the client writes, sends a document or asks for a quote.")}
          </InfoHint>
        </p>
        {value.manager ? (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{value.manager.full_name}</span>
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...value, manager: null })}>
              {tr("Change")}
            </Button>
          </div>
        ) : (
          <EmployeePicker
            id="new-client-account-manager"
            label={tr("Account manager")}
            placeholder={tr("Search by name or job title…")}
            requireAccount
            source={CANDIDATES}
            exclude={chosen}
            onPick={(hit) => onChange({ ...value, manager: hit })}
          />
        )}
      </div>
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {tr("Also Notify")}
          <InfoHint label={tr("About also notify")}>
            {tr("Told too, with the account manager and the CEO.")}
          </InfoHint>
        </p>
        {value.also.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={tr("Also notify")}>
            {value.also.map((p) => (
              <li key={p.employee_id} className="flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs">
                <span>{p.full_name}</span>
                <button
                  type="button"
                  className="ml-0.5 rounded-full px-1 text-muted-foreground hover:text-foreground"
                  aria-label={tv("Stop telling {{name}}", { name: p.full_name || tr("this person") })}
                  onClick={() => onChange({ ...value, also: value.also.filter((x) => x.employee_id !== p.employee_id) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <EmployeePicker
          id="new-client-also-notify"
          label={tr("Add a person")}
          placeholder={tr("Search by name or job title…")}
          requireAccount
          source={CANDIDATES}
          exclude={chosen}
          onPick={(hit) => onChange({ ...value, also: [...value.also, hit] })}
        />
      </div>
    </div>
  );
}

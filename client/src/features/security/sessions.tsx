/**
 * Security — live sessions, and revoking them.
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7).
 *
 * Reference adoption for `useAction` + the mutation envelope. The two handlers
 * that used to `try/catch/setError` and stay silent on success or on a no-op
 * are now three-line wrappers that get every branch — real revoke, already
 * revoked, and 4xx/5xx — right. See doc/ERROR_HANDLING.md.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Pill } from "@/components/ui/pill";
import { useList } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";
import { RowActions } from "@/components/ui/row-actions";
import { useConfirm } from "@/components/ui/use-confirm";
import { type Session, shell } from "./shared";

export function SessionsPage() {
  /*
   * REVOKING HAD NO CONFIRMATION, AND ITS CONSEQUENCE WAS ON ANOTHER SCREEN.
   *
   * `kill.run(r.session_id)` fired straight from the button, and "Revoke all
   * mine" the same way. What revoking actually does was written in the hub's
   * Panel `subtitle` — "Revoking invalidates the refresh token immediately" —
   * which renders UPPERCASE at caption size, on a panel that has no revoke
   * button, two screens away from the one that does.
   *
   * §3.17 puts a consequence at the moment of commit, so it is in the confirm
   * body here, and the hub's caption is gone.
   */
  const [confirm, confirmDialog] = useConfirm();
  const [tab, setTab] = React.useState<"mine" | "all">("mine");
  const mine = useList<Session>("/sessions/mine");
  const all = useList<Session>(tab === "all" ? "/sessions" : null);

  const killAllMine = useAction(
    () => tenant("/sessions/mine/revoke-all", { method: "POST" }),
    {
      success: "All other sessions revoked",
      idle: "No other sessions to revoke.",
      onSuccess: () => mine.reload(),
    },
  );

  const kill = useAction(
    (id: string) => tenant(`/sessions/${id}/kill`, { method: "POST" }),
    {
      success: "Session revoked",
      idle: "That session was already revoked.",
      onSuccess: () => {
        mine.reload();
        all.reload();
      },
    },
  );

  // A single row-level error surface: whichever action failed most recently.
  // Kept for parity with the previous behaviour — the toast is the primary
  // channel now, but the inline banner is what a screen-reader user hears
  // if the toast times out before they reach it.
  const error = kill.error || killAllMine.error;

  const baseCols: Column<Session>[] = [
    {
      key: "created_at",
      label: "Started",
      render: (r) => <span className="num">{dateFmt(r.created_at)}</span>,
    },
    {
      key: "last_seen_at",
      label: "Last Seen",
      render: (r) => <span className="num">{dateFmt(r.last_seen_at)}</span>,
    },
    {
      key: "ip",
      label: "IP",
      render: (r) => (
        <span className="num text-muted-foreground">{r.ip || "—"}</span>
      ),
    },
    {
      key: "user_agent",
      label: "Device",
      render: (r) => (
        <span className="text-muted-foreground">
          {(r.user_agent || "—").slice(0, 48)}
        </span>
      ),
    },
    {
      key: "state",
      label: "State",
      render: (r) =>
        r.killed_at ? (
          <Pill tone="bad">{tr("Revoked")}</Pill>
        ) : r.expired ? (
          // Timed out (two-hour ceiling or idle) — over, but never "revoked".
          <Pill tone="mute">{tr("Ended")}</Pill>
        ) : (
          <Pill tone="ok">{tr("Active")}</Pill>
        ),
    },
  ];

  const withKill: Column<Session>[] = [
    ...baseCols,
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button
            size="sm"
            variant="outline"
            disabled={!!r.killed_at || !!r.expired || kill.busy}
            onClick={async () => {
              const ok = await confirm({
                title: "Revoke This Session?",
                body: "That sign-in stops working at once, and the next attempt to refresh it is rejected. Whoever is using it has to sign in again.",
                confirmLabel: "Revoke Session",
                destructive: true,
              });
              if (ok) kill.run(r.session_id);
            }}
          >
            Revoke
          </Button>
        </RowActions>
      ),
    },
  ];

  const adminCols: Column<Session>[] = [
    {
      key: "user_id",
      label: "User",
      render: (r) => (
        <span className="num text-muted-foreground">
          {r.user_id ? `…${r.user_id.slice(-8)}` : "—"}
        </span>
      ),
    },
    ...withKill,
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & Access" to="/security" />}
        title={tr("Sessions")}
        description="Every sign-in currently active on this account, and where it came from."
        action={
          tab === "mine" ? (
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await confirm({
                  title: "Revoke All Other Sessions?",
                  body: "Every other sign-in on your account stops working at once, on every device. This session stays.",
                  confirmLabel: "Revoke All Others",
                  destructive: true,
                });
                if (ok) killAllMine.run();
              }}
              loading={killAllMine.busy}
            >
              Revoke All Mine
            </Button>
          ) : undefined
        }
      />
      {confirmDialog}
      <HubTabs />
      <Segmented
        label="Session scope"
        variant="solid"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "mine", label: "My Sessions" },
          { value: "all", label: "All Sessions" },
        ]}
      />
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      {tab === "mine" ? (
        <DataList
          columns={withKill}
          rows={mine.rows}
          error={mine.error}
          loading={mine.loading}
          rowKey={(r) => r.session_id}
          empty={{
            title: "No active sessions",
            hint: "You're signed in on this device only.",
          }}
        />
      ) : (
        <DataList
          columns={adminCols}
          rows={all.rows}
          error={all.error}
          loading={all.loading}
          rowKey={(r) => r.session_id}
          empty={{
            title: "No sessions",
            hint: "Listing every tenant session needs the session view grant.",
          }}
        />
      )}
    </section>
  );
}

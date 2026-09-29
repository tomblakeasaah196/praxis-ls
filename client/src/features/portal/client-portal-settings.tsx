/**
 * Client-portal settings that apply to EVERY client — the "Client portal"
 * section of ⚙ Settings on the Clients list. One client's people and checklist
 * are on that client's 360; what is the same for all of them is here:
 *
 *   NEW INVITATIONS   what a newly invited person sees unless someone chooses
 *                     otherwise, and whether a client's first portal user
 *                     becomes its admin (so someone on their side can add
 *                     colleagues). Used by staff invites AND by a client
 *                     admin's own invite sheet in the portal.
 *   ONBOARDING STEPS  the checklist every client starts from (14240). Adding a
 *                     step reaches every client the next time their checklist
 *                     opens; switching one off drops it only where it is still
 *                     unticked — a ticked step is a record, not a setting.
 *   ELSEWHERE         the portal settings that belong to another screen, one
 *                     tap away rather than re-implemented here.
 *
 * Every control is a full-width row or a ≥ 36px button, so the section reads
 * and works the same in the phone's bottom sheet as in the desktop dialog.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { tr, tv, currentLocale } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, isFeatureDisabled, useResource } from "@/lib/use-resource";
import { useCanOpenRoute } from "@/lib/route-access";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { Checkbox, RadioGroup } from "@/components/ui/checkbox";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ChevronIcon, PlusIcon } from "@/components/ui/icons";
import { SCOPE_LABEL, type PortalScope } from "./portal-scope";
import type { InviteDefaults } from "./client-portal-people";

type TemplateStep = {
  step_key: string;
  label_en: string;
  label_fr: string;
  sort_order: number;
  is_active: boolean;
};
type Settings = { invite_defaults: InviteDefaults; onboarding_steps: TemplateStep[] };

const SCOPES: PortalScope[] = ["ALL", "OPERATIONS", "BILLING"];

/** A card-like block with a heading — one per concern in this section. */
function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-3 sm:p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ClientPortalSettings() {
  const settings = useResource(() => tenant<Settings>("/portal/settings"), [], { fresh: true });

  if (isFeatureDisabled(settings.errorCode)) {
    return (
      <EmptyState
        title={tr("The client portal is not switched on")}
        hint={tr("It is part of the plan your administrator manages. These settings appear once it is on.")}
      />
    );
  }
  if (settings.error) return <ErrorState message={settings.error} />;
  if (!settings.data) return <LoadingRow label={tr("Loading…")} />;

  return (
    <div className="grid grid-cols-1 gap-4">
      <InviteDefaultsBlock value={settings.data.invite_defaults} onSaved={settings.reload} />
      <OnboardingTemplateBlock steps={settings.data.onboarding_steps} onChanged={settings.reload} />
      <ElsewhereBlock />
    </div>
  );
}

/* ── new invitations ────────────────────────────────────────────────────── */

function InviteDefaultsBlock({ value, onSaved }: { value: InviteDefaults; onSaved: () => void }) {
  const toast = useToast();
  const [scope, setScope] = React.useState<PortalScope>(value.access_scope);
  const [firstAdmin, setFirstAdmin] = React.useState(value.first_is_admin);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setScope(value.access_scope);
    setFirstAdmin(value.first_is_admin);
  }, [value.access_scope, value.first_is_admin]);
  const dirty = scope !== value.access_scope || firstAdmin !== value.first_is_admin;

  async function save() {
    setBusy(true);
    try {
      await tenant("/portal/settings/invite-defaults", {
        method: "POST",
        body: { access_scope: scope, first_is_admin: firstAdmin },
      });
      toast.success(tr("Saved. New invitations start from these."));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block
      title={tr("New invitations")}
      hint={tr("What someone invited to a client's portal starts with. It can always be changed for one person.")}
    >
      <div className="grid grid-cols-1 gap-3">
        <Field label={tr("What they see by default")}>
          <RadioGroup
            aria-label={tr("What they see by default")}
            value={scope}
            onValueChange={(v) => setScope(v as PortalScope)}
            options={SCOPES.map((s) => ({ value: s, label: tr(SCOPE_LABEL[s]) }))}
          />
        </Field>
        <Checkbox
          checked={firstAdmin}
          onCheckedChange={setFirstAdmin}
          label={tr("Make a client's first portal user its admin")}
          hint={tr("So someone on the client's side can invite their colleagues without asking you.")}
        />
        <div className="flex justify-end">
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()} className="w-full sm:w-auto">
            {tr("Save")}
          </Button>
        </div>
      </div>
    </Block>
  );
}

/* ── onboarding steps ───────────────────────────────────────────────────── */

function OnboardingTemplateBlock({ steps, onChanged }: { steps: TemplateStep[]; onChanged: () => void }) {
  const toast = useToast();
  const fr = currentLocale().startsWith("fr");
  const active = steps.filter((s) => s.is_active);
  const off = steps.filter((s) => !s.is_active);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showOff, setShowOff] = React.useState(false);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  const stepPath = (key: string) => `/portal/settings/onboarding-steps/${encodeURIComponent(key)}`;
  const move = (s: TemplateStep, direction: "up" | "down") =>
    act(s.step_key, () => tenant(`${stepPath(s.step_key)}/move`, { method: "POST", body: { direction } }));
  const setActive = (s: TemplateStep, isActive: boolean) =>
    act(
      s.step_key,
      () => tenant(stepPath(s.step_key), { method: "POST", body: { is_active: isActive } }),
      isActive ? tr("Step switched back on.") : tr("Step switched off. Clients who already ticked it keep it."),
    );
  const label = (s: TemplateStep) => (fr ? s.label_fr || s.label_en : s.label_en || s.label_fr);

  return (
    <Block
      title={tr("Onboarding steps")}
      hint={tr("The checklist every client starts from, shown in their portal. A new step reaches every client; a step switched off leaves the lists where it is already ticked.")}
    >
      {active.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">{tr("No steps yet — clients see no checklist.")}</p>
      ) : (
        <ol className="mb-3 divide-y overflow-hidden rounded-lg border">
          {active.map((s, i) =>
            editing === s.step_key ? (
              <li key={s.step_key} className="p-3">
                <StepForm
                  initial={{ en: s.label_en, fr: s.label_fr }}
                  busy={busy === s.step_key}
                  submitLabel={tr("Save")}
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) =>
                    act(s.step_key, async () => {
                      await tenant(stepPath(s.step_key), { method: "POST", body: { label_en: v.en, label_fr: v.fr || v.en } });
                      setEditing(null);
                    }, tr("Step renamed for every client."))
                  }
                />
              </li>
            ) : (
              <li key={s.step_key} className="flex min-h-[52px] items-center gap-2 px-3 py-2">
                <span aria-hidden className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                {/* Wraps rather than truncates: beside three 36px buttons a
                    phone leaves ~170px, and "Company profile comp…" is not a
                    step anyone can recognise. */}
                <span className="min-w-0 flex-1 break-words">
                  <span className="block text-sm font-medium text-foreground">{label(s)}</span>
                  <span className="block text-xs text-muted-foreground">{fr ? s.label_en : s.label_fr}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={tv("Move {{step}} up", { step: label(s) })}
                    disabled={i === 0 || busy !== null}
                    onClick={() => void move(s, "up")}
                  >
                    <ChevronIcon className="rotate-180" width={16} height={16} />
                  </IconButton>
                  <IconButton
                    label={tv("Move {{step}} down", { step: label(s) })}
                    disabled={i === active.length - 1 || busy !== null}
                    onClick={() => void move(s, "down")}
                  >
                    <ChevronIcon width={16} height={16} />
                  </IconButton>
                  <MoreMenu label={tv("Actions for {{step}}", { step: label(s) })}>
                    <DropdownItem onSelect={() => setEditing(s.step_key)}>{tr("Rename")}</DropdownItem>
                    <DropdownItem destructive onSelect={() => void setActive(s, false)}>
                      {tr("Switch off")}
                    </DropdownItem>
                  </MoreMenu>
                </div>
              </li>
            ),
          )}
        </ol>
      )}

      {adding ? (
        <div className="rounded-lg border p-3">
          <StepForm
            initial={{ en: "", fr: "" }}
            busy={busy === "__new"}
            submitLabel={tr("Add step")}
            onCancel={() => setAdding(false)}
            onSubmit={(v) =>
              act("__new", async () => {
                await tenant("/portal/settings/onboarding-steps", { method: "POST", body: { label_en: v.en, label_fr: v.fr || null } });
                setAdding(false);
              }, tr("Step added — every client's checklist now has it."))
            }
          />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          icon={<PlusIcon width={16} height={16} />}
          onClick={() => setAdding(true)}
          className="w-full sm:w-auto"
        >
          {tr("Add a step")}
        </Button>
      )}

      {off.length ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showOff}
            onClick={() => setShowOff((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronIcon className={cn("transition-transform", showOff ? "" : "-rotate-90")} width={14} height={14} />
            {tv("Switched off ({{n}})", { n: off.length })}
          </button>
          {showOff ? (
            <ul className="mt-2 divide-y overflow-hidden rounded-lg border">
              {off.map((s) => (
                <li key={s.step_key} className="flex min-h-[48px] items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label(s)}</span>
                  <Button size="sm" variant="ghost" icon={null} loading={busy === s.step_key} onClick={() => void setActive(s, true)}>
                    {tr("Switch on")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Block>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function StepForm({
  initial,
  busy,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: { en: string; fr: string };
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: { en: string; fr: string }) => void;
}) {
  const [en, setEn] = React.useState(initial.en);
  const [frLabel, setFr] = React.useState(initial.fr);
  const valid = en.trim().length >= 2;
  return (
    <form
      className="grid grid-cols-1 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ en: en.trim(), fr: frLabel.trim() });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("In English")} required>
          <Input value={en} onChange={(e) => setEn(e.target.value)} maxLength={160} placeholder="Customs mandate signed" />
        </Field>
        <Field label={tr("In French")} hint={tr("Optional — the English is shown when empty.")}>
          <Input value={frLabel} onChange={(e) => setFr(e.target.value)} maxLength={160} placeholder="Mandat de dédouanement signé" />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="w-full sm:w-auto">
          {tr("Cancel")}
        </Button>
        <Button type="submit" size="sm" loading={busy} disabled={!valid} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ── elsewhere ──────────────────────────────────────────────────────────── */

const ELSEWHERE: { to: string; label: string; desc: string }[] = [
  { to: "/comms/clients", label: "Client conversations", desc: "Every client's portal chat, those waiting for an answer first" },
  { to: "/appearance", label: "How the portal looks", desc: "Your logo and colours, used on the portal too" },
  { to: "/settings/catalogue", label: "Portal features on your plan", desc: "Which portals and features are switched on" },
  { to: "/settings/portal-access", label: "Investor & auditor access", desc: "The other two portals, and who can open them" },
];

function ElsewhereBlock() {
  const canOpen = useCanOpenRoute();
  const links = ELSEWHERE.filter((l) => canOpen(l.to));
  if (!links.length) return null;
  return (
    <Block title={tr("Also for the portal")}>
      <ul className="-mx-3 -mb-3 divide-y border-t sm:-mx-4 sm:-mb-4">
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="flex min-h-[52px] items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{tr(l.label)}</span>
                <span className="block text-xs text-muted-foreground">{tr(l.desc)}</span>
              </span>
              <ChevronIcon className="-rotate-90 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}

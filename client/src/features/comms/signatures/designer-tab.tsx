/**
 * Signatures → Designer. One person's own signature: the fields they type, a
 * live card, and the PNG download.
 *
 * WHAT IS NOT EDITABLE HERE, AND WHY. Name, job title, company, address, P.O.
 * Box, website and the motto are all derived — from HR, from `corporate_entity`
 * and from the template. They are shown, greyed, with where they come from,
 * rather than hidden: someone whose title is wrong needs to know the fix is a
 * word with HR, not a box on this page they cannot find. It also means a
 * promotion reaches every future signature with nobody remembering to come here
 * — the property the whole engine exists for.
 *
 * The standalone generator this replaces had all nine fields typed by hand,
 * which is exactly why a stale job title could sit in someone's signature for a
 * year.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { CardPreview } from "./card-preview";

type Lang = "en" | "fr";

/** The subset of `user_signature_profile` this screen edits. Keyed rather than
 *  hand-written per field so the label, the read and the write cannot drift. */
type TypedKey = "phone_desk" | "phone_mobile" | "whatsapp" | "pronouns";

/** The four fields `user_signature_profile` actually stores for a person. */
const TYPED: { key: TypedKey; label: string; hint?: string }[] = [
  { key: "phone_desk", label: "Desk phone" },
  { key: "phone_mobile", label: "Mobile" },
  { key: "whatsapp", label: "WhatsApp", hint: "Shown only if the template asks for it" },
  { key: "pronouns", label: "Pronouns", hint: "Shown only if the template asks for it" },
];

export function DesignerTab() {
  const toast = useToast();
  const [lang, setLang] = React.useState<Lang>("en");
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const { data: me, error, reload } = useResource(() => api.getSignatureProfile(), []);
  const {
    data: card,
    error: cardError,
    reload: reloadCard,
  } = useResource(() => api.getSignatureCard(lang), [lang]);

  const profile = ((me && !Array.isArray(me) ? me.profile : null) ||
    {}) as Partial<Record<TypedKey, string | null>>;
  const person = ((me && !Array.isArray(me) ? me.person : null) ||
    {}) as Partial<Record<"employee_full_name" | "user_full_name" | "job_title", string | null>>;

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaveError(null);
    try {
      await api.saveSignatureProfile(patch);
      toast.success(tr("Signature updated"));
      reload();
      // The card is server-rendered, so a saved field only shows once it is
      // re-fetched. Without this the person edits a phone number and watches
      // nothing happen.
      reloadCard();
    } catch (err) {
      reportActionError(err);
      setSaveError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPng(scale: 1 | 2 | 3) {
    setBusy(true);
    try {
      await api.downloadSignaturePng({ language: lang, scale });
      toast.success(tr("Signature downloaded"));
    } catch (err) {
      reportActionError(err);
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (me === null) return <SkeletonTable />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="lux-card space-y-3 p-4">
          <h2 className="text-sm font-semibold">{tr("Your details")}</h2>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{tr("Name")}</dt>
              <dd className="text-right font-medium">
                {person.employee_full_name || person.user_full_name || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{tr("Job title")}</dt>
              <dd className="text-right font-medium">{person.job_title || "—"}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {tr(
              "Name and job title come from HR. A change there reaches your next email on its own.",
            )}
          </p>
        </div>

        <div className="lux-card space-y-3 p-4">
          <h2 className="text-sm font-semibold">{tr("What you can set")}</h2>
          {saveError && <ErrorState message={saveError} />}
          <div
            key={TYPED.map((f) => profile[f.key] || "").join("|")}
            className="grid gap-3"
          >
            {TYPED.map((f) => (
              <Field key={f.key} label={tr(f.label)} hint={f.hint ? tr(f.hint) : undefined}>
                <Input
                  defaultValue={profile[f.key] || ""}
                  disabled={busy}
                  onBlur={(e) =>
                    e.target.value !== (profile[f.key] || "") &&
                    save({ [f.key]: e.target.value || null })
                  }
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {tr(
              "Company name, address, P.O. Box, website and the motto come from your company profile and the signature template.",
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="lux-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{tr("Live preview")}</h2>
            <Segmented
              label={tr("Signature language")}
              value={lang}
              onChange={(v) => setLang(v)}
              options={[
                { value: "en", label: tr("English") },
                { value: "fr", label: tr("French") },
              ]}
            />
          </div>

          {cardError ? (
            <ErrorState message={cardError} />
          ) : (
            <div className="overflow-x-auto">
              <CardPreview
                loading={card === null}
                document={card?.document ?? null}
                width={card?.width ?? 650}
                height={card?.height ?? 325}
              />
            </div>
          )}
        </div>

        <div className="lux-card space-y-3 p-4">
          <h2 className="text-sm font-semibold">{tr("Download as an image")}</h2>
          <p className="text-sm text-muted-foreground">
            {tr(
              "Paste into Outlook, Gmail or webmail. 2× is the right choice for most screens.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === 2 ? "default" : "outline"}
                disabled={busy}
                onClick={() => downloadPng(s)}
              >
                {tr("Download PNG")} {s}×
              </Button>
            ))}
          </div>
          <Callout tone="info" title={tr("Your emails already carry this")}>
            {tr(
              "Mail sent from Praxis adds this signature on its own. The download is for mail clients you use outside the system.",
            )}
          </Callout>
        </div>
      </div>
    </div>
  );
}

export default DesignerTab;

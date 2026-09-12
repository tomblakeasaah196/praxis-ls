import * as React from "react";
import { tr } from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/ui/callout";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import * as api from "@/lib/operations-api";

/**
 * The assistant that turns a pasted service page into a page you can read.
 *
 * ── WHY A WIZARD AND NOT A BUTTON ──────────────────────────────────────────
 *
 * Three questions have to be answered before a draft means anything, and they
 * are not independent: whether there is existing copy to work from decides
 * whether "how much may I change it" is even a question. A row of buttons
 * labelled "Structure / Tighten / Rewrite / Write from scratch" puts a
 * destructive option (rewrite) one slip away from a safe one (structure) and
 * asks the author to hold the difference in their head. Three steps, each with
 * one decision, costs two extra clicks and removes that class of mistake.
 *
 * ── NOTHING IS APPLIED WITHOUT BEING READ ──────────────────────────────────
 *
 * The result lands in a review list, per field, with what is there now beside
 * what is proposed, and every row starts ACCEPTED-but-visible rather than
 * applied. Closing the dialog changes nothing. Accepting writes into the tab's
 * draft — still not to the server — so the author's own Save is the only thing
 * that ever persists a word of it.
 *
 * That is deliberate and not defensive habit: this screen's last defect was an
 * unattended write landing on top of authored copy, and an assistant that saved
 * its own output would be the same defect with the author's permission attached.
 */

type Step = 1 | 2 | 3;
type Source = "existing" | "scratch";
type Licence = "structure" | "tighten" | "rewrite";
type Level = api.ServiceTypeWebToneLevel;

const LEVELS: Level[] = ["off", "light", "strong"];

const AXIS_COPY: Record<
  api.ServiceTypeWebToneAxis,
  { name: string; blurb: string }
> = {
  operational: {
    name: "Operational / technical",
    blurb: "Real stage names, what actually happens, process accuracy.",
  },
  commercial: {
    name: "Commercial",
    blurb: "The benefit and the reassurance — the reason to call you.",
  },
  seo: {
    name: "Search (SEO)",
    blurb: "Keyword and entity coverage, heading shape, the meta fields.",
  },
  corridor: {
    name: "Corridor relevance",
    blurb: "Douala, the hinterland, OHADA, francophone trade. Nobody else's copy has this.",
  },
  plain: {
    name: "Plain language",
    blurb: "Short sentences, jargon kept in check. The axis that fights the wall of text.",
  },
};

/** The fields a proposal can carry, in the order the review list shows them. */
const REVIEW_ORDER: (keyof api.ServiceTypeWebProfilePatch)[] = [
  "short_description_en",
  "short_description_fr",
  "long_description_en",
  "long_description_fr",
  "highlights_en",
  "highlights_fr",
  "coverage_en",
  "coverage_fr",
  "claim_en",
  "claim_fr",
  "meta_title_en",
  "meta_title_fr",
  "meta_description_en",
  "meta_description_fr",
];

const FIELD_LABEL: Partial<Record<keyof api.ServiceTypeWebProfilePatch, string>> = {
  short_description_en: "Short description (EN)",
  short_description_fr: "Short description (FR)",
  long_description_en: "Long description (EN)",
  long_description_fr: "Long description (FR)",
  highlights_en: "Highlights (EN)",
  highlights_fr: "Highlights (FR)",
  coverage_en: "Coverage (EN)",
  coverage_fr: "Coverage (FR)",
  claim_en: "Closing line (EN)",
  claim_fr: "Closing line (FR)",
  meta_title_en: "Meta title (EN)",
  meta_title_fr: "Meta title (FR)",
  meta_description_en: "Meta description (EN)",
  meta_description_fr: "Meta description (FR)",
};

function asText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => `• ${String(x)}`).join("\n");
  return v == null ? "" : String(v);
}

/** A short, honest preview: enough to judge, not the whole page. */
function preview(v: unknown, max = 320): string {
  const s = asText(v).trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

function LevelPicker({
  value,
  onChange,
  disabled,
}: {
  value: Level;
  onChange: (v: Level) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1" role="group">
      {LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          disabled={disabled}
          aria-pressed={value === l}
          onClick={() => onChange(l)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs capitalize transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-blue))]",
            value === l
              ? "border-transparent bg-[rgb(var(--brand-blue))] text-white"
              : "bg-card text-muted-foreground hover:text-foreground",
            disabled && "opacity-50",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function ServiceTypeWebAiDialog({
  open,
  onClose,
  serviceTypeId,
  hasExistingCopy,
  current,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  serviceTypeId: string;
  /** Decides whether "use what is there" is offered at all. */
  hasExistingCopy: boolean;
  /** What is in the boxes now, for the before/after column. */
  current: api.ServiceTypeWebProfilePatch;
  /** Hands the accepted fields to the tab's draft. Never saves. */
  onApply: (patch: api.ServiceTypeWebProfilePatch) => void;
}) {
  const [step, setStep] = React.useState<Step>(1);
  const [source, setSource] = React.useState<Source>("existing");
  const [licence, setLicence] = React.useState<Licence>("structure");
  const [languageMode, setLanguageMode] = React.useState<"each" | "extend">("each");
  const [primary, setPrimary] = React.useState<"en" | "fr">("en");
  const [tone, setTone] = React.useState<api.ServiceTypeWebTone>(
    api.SERVICE_TYPE_WEB_TONE_DEFAULT,
  );
  const [instructions, setInstructions] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<api.ServiceTypeWebAiResult | null>(null);
  const [accepted, setAccepted] = React.useState<Record<string, boolean>>({});

  // A fresh dialog every time it opens — a wizard that remembers last week's
  // answers is a wizard that quietly rewrites a page on a default nobody re-read.
  React.useEffect(() => {
    if (!open) return;
    setStep(1);
    setSource(hasExistingCopy ? "existing" : "scratch");
    setLicence("structure");
    setLanguageMode("each");
    setPrimary("en");
    setTone(api.SERVICE_TYPE_WEB_TONE_DEFAULT);
    setInstructions("");
    setBusy(false);
    setError(null);
    setResult(null);
    setAccepted({});
  }, [open, hasExistingCopy]);

  const proposalKeys = React.useMemo(() => {
    const p = result?.proposal || {};
    return REVIEW_ORDER.filter((k) => {
      const v = p[k];
      return Array.isArray(v) ? v.length > 0 : Boolean(v);
    });
  }, [result]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.draftServiceTypeWebCopy(serviceTypeId, {
        source,
        licence: source === "existing" ? licence : undefined,
        language_mode: languageMode,
        primary,
        tone,
        instructions: instructions.trim() || undefined,
      });
      if (out.manual_required) {
        setError(out.reason || tr("The assistant could not draft this. Nothing has changed."));
        return;
      }
      setResult(out);
      // Everything starts accepted so the common case is one click — but every
      // row is visible with its before/after, so "accepted" is never "unseen".
      const next: Record<string, boolean> = {};
      for (const k of REVIEW_ORDER) {
        const v = out.proposal?.[k];
        if (Array.isArray(v) ? v.length > 0 : v) next[k] = true;
      }
      setAccepted(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function applyAccepted() {
    const p = result?.proposal || {};
    const patch: api.ServiceTypeWebProfilePatch = {};
    for (const k of proposalKeys) {
      if (accepted[k]) (patch as Record<string, unknown>)[k] = p[k];
    }
    onApply(patch);
    onClose();
  }

  const acceptedCount = proposalKeys.filter((k) => accepted[k]).length;

  /* ── the review step replaces the wizard once a draft exists ───────────── */
  if (result) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title={tr("Review the draft")}
        description={tr(
          "Nothing is saved yet. What you accept goes into the boxes on the tab; you still press Save.",
        )}
        headerRight={
          result.prose_preserved ? (
            <Pill tone="ok">{tr("Your wording unchanged")}</Pill>
          ) : (
            <Pill tone="warn">{tr("Rewritten")}</Pill>
          )
        }
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {tr("Discard")}
            </Button>
            <Button onClick={applyAccepted} disabled={acceptedCount === 0}>
              {acceptedCount === 1
                ? tr("Apply 1 field")
                : `${tr("Apply")} ${acceptedCount} ${tr("fields")}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {result.prose_preserved ? (
            <Callout tone="ok" title={tr("Your sentences were not touched")}>
              {tr(
                "The assistant only chose where the headings go. Your paragraphs were copied across word for word.",
              )}
            </Callout>
          ) : (
            <Callout tone="warn" title={tr("The assistant rewrote this copy")}>
              {tr(
                "Read each field before accepting it — the wording is no longer exactly what you wrote.",
              )}
            </Callout>
          )}

          {result.languages?.some((l) => !l.ok) && (
            <Callout tone="warn" title={tr("One language did not come back")}>
              {tr("Only the languages listed below were drafted. Nothing else changed.")}
            </Callout>
          )}

          <ul className="space-y-3">
            {proposalKeys.map((k) => {
              const now = preview(current[k]);
              const next = preview(result.proposal?.[k]);
              return (
                <li key={k} className="rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {tr(FIELD_LABEL[k] || String(k))}
                    </span>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(accepted[k])}
                        onChange={(e) =>
                          setAccepted((a) => ({ ...a, [k]: e.target.checked }))
                        }
                      />
                      {tr("Accept")}
                    </label>
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {tr("Now")}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {now || tr("— empty —")}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {tr("Proposed")}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm">{next}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Dialog>
    );
  }

  /* ── the three-step wizard ─────────────────────────────────────────────── */
  const canAdvance = step < 3;
  const stepTitle =
    step === 1
      ? tr("What should the assistant work from?")
      : step === 2
        ? tr("How much may it change your words?")
        : tr("Tone and language");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={tr("Draft with the assistant")}
      description={stepTitle}
      headerRight={
        <span className="text-xs text-muted-foreground">
          {tr("Step")} {step}/3
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          {step > 1 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStep((s) => (s === 3 ? (source === "scratch" ? 1 : 2) : 1))}
            >
              {tr("Back")}
            </Button>
          )}
          {canAdvance ? (
            <Button
              onClick={() =>
                // Licence is meaningless with no prose to protect, so drafting
                // from scratch skips that question rather than showing it disabled.
                setStep(step === 1 && source === "scratch" ? 3 : ((step + 1) as Step))
              }
            >
              {tr("Next")}
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void generate()}>
              {tr("Draft it")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Callout tone="bad" title={tr("The assistant could not draft this")}>
            {error}
          </Callout>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <ChoiceCard
              selected={source === "existing"}
              disabled={!hasExistingCopy}
              onSelect={() => setSource("existing")}
              title={tr("Use what is in the boxes")}
              body={
                hasExistingCopy
                  ? tr(
                      "Reads the copy you have written and gives it a shape: headings, highlights, the short description and the meta fields.",
                    )
                  : tr("There is no copy on this service yet.")
              }
            />
            <ChoiceCard
              selected={source === "scratch"}
              onSelect={() => setSource("scratch")}
              title={tr("Draft from scratch")}
              body={tr(
                "Ignores the boxes entirely and writes a first draft from the service name. Nothing you have written is sent.",
              )}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <ChoiceCard
              selected={licence === "structure"}
              onSelect={() => setLicence("structure")}
              title={tr("Structure only — do not reword")}
              body={tr(
                "Adds headings between your paragraphs and derives the highlights and meta fields. Your sentences are copied across word for word, guaranteed — the assistant is never given them to rewrite.",
              )}
            />
            <ChoiceCard
              selected={licence === "tighten"}
              onSelect={() => setLicence("tighten")}
              title={tr("Structure and tighten")}
              body={tr(
                "As above, and may also cut repetition and split overlong paragraphs. Your wording is no longer guaranteed.",
              )}
            />
            <ChoiceCard
              selected={licence === "rewrite"}
              onSelect={() => setLicence("rewrite")}
              title={tr("Full rewrite")}
              body={tr(
                "Rewrites freely for the tone below, using your text as source material. Most polished, least yours — the search wording you chose can change.",
              )}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="space-y-3">
              {api.SERVICE_TYPE_WEB_TONE_AXES.map((axis) => (
                <div
                  key={axis}
                  className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{tr(AXIS_COPY[axis].name)}</p>
                    <p className="text-xs text-muted-foreground">
                      {tr(AXIS_COPY[axis].blurb)}
                    </p>
                  </div>
                  <LevelPicker
                    value={tone[axis]}
                    onChange={(v) => setTone((t) => ({ ...t, [axis]: v }))}
                  />
                </div>
              ))}
            </div>

            {source === "existing" && (
              <Field
                label={tr("Languages")}
                hint={tr(
                  "Each on its own keeps your French reading as French rather than as a translation.",
                )}
              >
                <Segmented
                  label={tr("Languages")}
                  value={languageMode}
                  onChange={(v) => setLanguageMode(v as "each" | "extend")}
                  options={[
                    { value: "each", label: tr("Each on its own") },
                    { value: "extend", label: tr("Extend one to the other") },
                  ]}
                />
              </Field>
            )}

            {source === "existing" && languageMode === "extend" && (
              <Field label={tr("Write the other language from")}>
                <Select
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value as "en" | "fr")}
                >
                  <option value="en">{tr("English → French")}</option>
                  <option value="fr">{tr("French → English")}</option>
                </Select>
              </Field>
            )}

            <Field
              label={tr("Anything else (optional)")}
              hint={tr("In your own words — a angle to take, a term to prefer, something to avoid.")}
            >
              <Textarea
                rows={3}
                maxLength={2000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ChoiceCard({
  selected,
  disabled,
  onSelect,
  title,
  body,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-blue))]",
        selected
          ? "border-[rgb(var(--brand-blue))] bg-[rgb(var(--brand-blue)/0.08)]"
          : "bg-card hover:border-muted-foreground/40",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </button>
  );
}

export default ServiceTypeWebAiDialog;

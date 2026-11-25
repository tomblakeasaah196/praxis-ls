import * as React from "react";
import { useTranslation } from "react-i18next";
import * as engine from "@praxis/shared/rules/quote-engine";
import type { QeAnswers, QeResult, QeService, QeStep } from "@praxis/shared/rules/quote-engine";
import { cn } from "@/lib/cn";
import { getLang } from "@/lib/i18n";
import type { ServiceCard } from "@/lib/services-api";
import "@/components/quote/quote-steps-i18n";

/**
 * "Your Terms": the quote engine's questions for one website service (SmartLS
 * website v2, PR 3).
 *
 * The visitor says which way the goods go, then whether they know their
 * Incoterm. Yes: they pick it, from the terms this service quotes for its mode
 * (never FOB by air). No: three plain questions (buying or selling, where our
 * work begins, where it ends, and who insures when that is the one fact left)
 * and the engine names the term in a sentence. "Not sure" is allowed at every
 * question and sends the request to the desk only where the service depends on
 * it.
 *
 * The questions are NOT written here. `@praxis/shared/rules/quote-engine` says
 * which apply, in what order, with which choices, and the API runs the same
 * module on submit, so the form and the desk can never disagree about what the
 * answers mean. This file draws them.
 *
 * A lazy chunk: the engine and this step load while the visitor answers the
 * first question, and no other page pays for them.
 */

/** The engine's view of a website service, from the public payload. */
export function descriptorOf(s: ServiceCard, lang: string): QeService {
  const q = s.quote;
  return {
    id: s.service_type_id,
    card: q ? q.card : null,
    members: (q ? q.members : []).map((m) => ({
      id: m.service_type_id,
      name: (lang === "fr" ? m.name_fr || m.name_en : m.name_en || m.name_fr) || "",
      flow: m.flow,
      incoterms: m.incoterms,
    })),
  };
}

export function evaluateFor(s: ServiceCard, answers: QeAnswers, lang: string): QeResult {
  return engine.evaluate(descriptorOf(s, lang), answers, s.quote ? s.quote.rules : []);
}

/** Port, airport, or both, by the service's card. */
const placeMode = (card: string | null | undefined) => (card === "SEA" ? "SEA" : card === "AIR" ? "AIR" : "ANY");

function Choice({
  name,
  value,
  checked,
  label,
  hint,
  mono,
  onPick,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  hint?: string | null;
  mono?: boolean;
  onPick: (v: string) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-[44px] cursor-pointer flex-col items-start justify-center rounded-[calc(var(--radius)-2px)] border px-3.5 py-1.5 text-sm",
        "hover:border-[rgb(var(--ink)/0.25)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--brand-orange))]",
        checked && "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange)/0.06)] shadow-[var(--pick-ring)]",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={() => onPick(value)} className="sr-only" />
      <span className={cn(mono && "font-mono", checked && "font-semibold")}>{label}</span>
      {hint ? <span className="text-[0.7rem] leading-tight text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function QuoteTermsStep({
  service,
  answers,
  onAnswers,
  onResult,
  idPrefix = "quote",
}: {
  service: ServiceCard;
  answers: QeAnswers;
  onAnswers: (next: QeAnswers) => void;
  onResult: (result: QeResult) => void;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const fr = lang === "fr";
  const result = React.useMemo(() => evaluateFor(service, answers, lang), [service, answers, lang]);

  React.useEffect(() => {
    onResult(result);
  }, [result, onResult]);

  const card = service.quote ? service.quote.card : null;
  const mode = placeMode(card);
  const party = result.answers.party === "SELLER" ? "SELLER" : "BUYER";
  const hinterlandOnly = (service.quote?.members || []).every((m) => m.flow === "HINTERLAND");

  /** A new answer clears every answer after it: the questions that follow depend on it. */
  function answer(step: QeStep, value: string) {
    const order = result.steps.map((s) => s.id);
    const at = order.indexOf(step.id);
    const next: QeAnswers = {};
    for (const id of order.slice(0, at)) next[id] = answers[id];
    next[step.id] = value;
    onAnswers(next);
  }

  const optionLabel = (step: QeStep, value: string): { label: string; hint?: string | null; mono?: boolean } => {
    switch (step.id) {
      case "direction":
        return hinterlandOnly
          ? {
              label: t(`site.quoteSteps.hinterland${value === "EXPORT" ? "OUT_OF" : "INTO"}`),
              hint: t(`site.quoteSteps.hinterland${value === "EXPORT" ? "OUT_OF" : "INTO"}Hint`),
            }
          : { label: t(`site.quoteSteps.engineDirection${value}`), hint: t(`site.quoteSteps.engineDirection${value}Hint`) };
      case "knows":
        return { label: t(`site.quoteSteps.engineKnows${value}`), hint: value === "NO" ? t("site.quoteSteps.engineKnowsNOHint") : null };
      case "incoterm":
        return { label: value, mono: true };
      case "party":
        return { label: t(`site.quoteSteps.engineParty${value}`) };
      case "start":
      case "end": {
        if (value === "SUPPLIER_PREMISES" || value === "PREMISES" || value === "PREMISES_DUTY_PAID") {
          return { label: t(`site.quoteSteps.enginePoint${value}_${party}`) };
        }
        return { label: t(`site.quoteSteps.enginePoint${value}_${mode}`) };
      }
      case "insured":
        return { label: t(`site.quoteSteps.engineInsured${value}`) };
      default:
        return { label: value };
    }
  };

  const legend = (step: QeStep) => {
    switch (step.id) {
      case "direction":
        return hinterlandOnly ? t("site.quoteSteps.hinterland") : t("site.quoteSteps.engineDirection");
      case "knows":
        return t("site.quoteSteps.engineKnows");
      case "incoterm":
        return t("site.quoteSteps.engineIncoterm");
      case "party":
        return t("site.quoteSteps.engineParty");
      case "start":
        return t("site.quoteSteps.engineStart");
      case "end":
        return t("site.quoteSteps.engineEnd");
      case "insured":
        return t(`site.quoteSteps.engineInsured${party}`);
      default:
        return t("site.quoteSteps.engineMember");
    }
  };

  const scope = engine.describeScope(result.scope);
  const explanation = result.explanation ? (fr ? result.explanation.fr : result.explanation.en) : null;

  return (
    <div className="space-y-5">
      {result.steps.map((step) => {
        const name = `${idPrefix}-terms-${step.id}`;
        const options: { value: string; label: string; hint?: string | null; mono?: boolean }[] =
          step.id === "member"
            ? (step.options as { id: string; name: string }[]).map((o) => ({ value: o.id, label: o.name }))
            : (step.options as string[]).map((v) => ({ value: v, ...optionLabel(step, v) }));
        return (
          <fieldset key={step.id}>
            <legend className="field-label">{legend(step)}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {options.map((o) => (
                <Choice
                  key={o.value}
                  name={name}
                  value={o.value}
                  checked={step.answer === o.value}
                  label={o.label}
                  hint={o.hint || null}
                  mono={Boolean(o.mono)}
                  onPick={(v) => answer(step, v)}
                />
              ))}
              {step.not_sure ? (
                <Choice
                  name={name}
                  value={engine.NOT_SURE}
                  checked={step.answer === engine.NOT_SURE}
                  label={t("site.quoteSteps.incotermNotSure")}
                  onPick={(v) => answer(step, v)}
                />
              ) : null}
            </div>
          </fieldset>
        );
      })}

      {result.complete ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[calc(var(--radius)-2px)] border bg-[var(--secondary)] px-4 py-3 text-sm"
        >
          {/* The term's sentence, unless the term itself is what nobody knows;
              then, for a request the desk must place, the desk's line. */}
          {explanation && !(result.outcome === "DESK" && result.incoterm_source === "NOT_SURE") ? <p>{explanation}</p> : null}
          {result.outcome === "DESK" ? <p className={cn(explanation && result.incoterm_source !== "NOT_SURE" && "mt-2")}>{t("site.quoteSteps.engineDesk")}</p> : null}
          {scope.length ? (
            <>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("site.quoteSteps.engineHandle")}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {scope.map((s) => (
                  <li key={s.flag} className="rounded-full border px-2.5 py-0.5 text-xs">
                    {fr ? s.fr : s.en}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default QuoteTermsStep;

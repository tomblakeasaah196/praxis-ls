/**
 * Why a website request landed on its service type (SmartLS website v2, PR 3,
 * migration 14640).
 *
 * The visitor picked a website service ("Sea Freight") and answered the quote
 * engine's questions; the intake ran the engine and stored its answer on the
 * request. The desk reads it here: the website service, the direction, the
 * Incoterm and how it was reached, the sentence the visitor was shown, the
 * scope of the work, and, for a request the engine could not place, that it
 * is waiting for the desk to choose the service and why.
 */
import * as React from "react";
import { quoteEngine } from "@shared";
import { tr, currentLocale } from "@/lib/i18n";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";

type Routing = {
  website_service_name?: string;
  outcome?: "RESOLVED" | "DESK";
  reason?: string | null;
  span?: string | null;
  party?: string | null;
  explanation?: { en?: string; fr?: string } | null;
  answers?: Record<string, string>;
};

const SOURCE_LABEL: Record<string, string> = {
  PICKED: "Picked by the Visitor",
  DERIVED: "Worked Out From Their Answers",
  NOT_SURE: "To Be Confirmed",
  NOT_APPLICABLE: "Not Applicable",
};

const DIRECTION_LABEL: Record<string, string> = { IMPORT: "Importing", EXPORT: "Exporting" };

const PARTY_LABEL: Record<string, string> = { BUYER: "Buying", SELLER: "Selling", NOT_SURE: "Not Sure" };

const POINT_LABEL: Record<string, string> = {
  SUPPLIER_PREMISES: "Supplier's Premises",
  ORIGIN_PORT: "Port or Airport of Loading",
  DESTINATION_PORT: "Port or Airport of Arrival",
  PREMISES: "Buyer's Premises",
  PREMISES_DUTY_PAID: "Buyer's Premises, Duties Paid",
  NOT_SURE: "Not Sure",
};

/** Why the engine left a request to the desk, in a sentence the desk can act on. */
const REASON: Record<string, string> = {
  NOT_SURE: "The visitor was not sure of an answer the service depends on.",
  RULE_DESK: "The routing rules send this work to the desk.",
  NO_RULE: "No routing rule covers this work.",
  NO_MEMBER: "The website service has no service type for this work.",
  TERM_NOT_OFFERED: "The Incoterm is not one the matching service quotes.",
  INVALID: "The answers did not match the questions.",
};

function asRouting(v: unknown): Routing | null {
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Routing;
    } catch {
      /* @silent:parse — a stored value that is not JSON shows nothing rather than breaking the sheet. */
      return null;
    }
  }
  return typeof v === "object" ? (v as Routing) : null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="micro">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function QuoteRoutingFacts({ request }: { request: Record<string, unknown> }) {
  const routing = asRouting(request.quote_routing);
  if (!routing) return null;
  const fr = currentLocale().startsWith("fr");
  const scope = (request.service_scope && typeof request.service_scope === "object"
    ? request.service_scope
    : null) as Record<string, boolean> | null;
  const answers = routing.answers || {};
  const sentence = routing.explanation ? (fr ? routing.explanation.fr : routing.explanation.en) || routing.explanation.en : null;
  const source = String(request.incoterm_source || "");
  const direction = String(request.trade_direction || "");

  return (
    <section className="space-y-3 rounded-xl border p-3" data-testid="quote-routing-facts">
      <h4 className="text-sm font-semibold text-foreground">{tr("Why This Service")}</h4>
      {routing.outcome === "DESK" ? (
        <Callout tone="warn" title={tr("Desk Review")}>
          {tr(REASON[String(routing.reason)] || "The answers did not decide the service.")}
        </Callout>
      ) : null}
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {routing.website_service_name ? <Fact label={tr("Website Service")}>{routing.website_service_name}</Fact> : null}
        {direction ? <Fact label={tr("Direction")}>{tr(DIRECTION_LABEL[direction] || direction)}</Fact> : null}
        {source ? <Fact label={tr("Incoterm Reached")}>{tr(SOURCE_LABEL[source] || source)}</Fact> : null}
        {answers.party ? <Fact label={tr("Buying or Selling")}>{tr(PARTY_LABEL[answers.party] || answers.party)}</Fact> : null}
        {answers.start ? <Fact label={tr("Work Begins")}>{tr(POINT_LABEL[answers.start] || answers.start)}</Fact> : null}
        {answers.end ? <Fact label={tr("Work Ends")}>{tr(POINT_LABEL[answers.end] || answers.end)}</Fact> : null}
      </dl>
      {sentence ? <p className="text-sm text-foreground">{sentence}</p> : null}
      {scope ? (
        <div className="flex flex-wrap gap-1.5" aria-label={tr("Scope of Work")}>
          {quoteEngine.describeScope(scope as Parameters<typeof quoteEngine.describeScope>[0]).map((s) => (
            <Pill key={s.flag} tone="blue">{fr ? s.fr : s.en}</Pill>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default QuoteRoutingFacts;

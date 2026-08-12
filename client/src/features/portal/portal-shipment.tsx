/**
 * A client looking at one of their own shipments.
 *
 * WHAT A CLIENT SEES, and what they deliberately do not. The stages their
 * forwarder chose to show them (`is_client_visible`, set per stage in the
 * template editor — our invoicing and internal handling stages are not their
 * business), each with the date they were COMMITTED to. Not our internal
 * forecast, unless the tenant has turned that on: a forecast that moves twice a
 * week reads as a schedule nobody is in control of.
 *
 * AND THE CONDITIONS, IN THE SAME VIEW. The published assumptions sit directly
 * under the chain, because that is the entire point of publishing them. Customs
 * keeps its own hours, the terminal shuts on Sundays, a red-channel declaration
 * costs a day, and a port strike is nobody's fault. A client who reads the
 * dates and the conditions together has a conversation when something slips; a
 * client who was shown only dates has an argument.
 */
import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { dateFmt } from "@/lib/format";
import { portalClientChain, type PortalChain } from "@/lib/portal-api";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const STATUS_LABEL: Record<string, string> = {
  PENDING: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  BLOCKED: "On hold",
};

const statusTone = (s: string): "ok" | "warn" | "mute" | "blue" => {
  switch (String(s || "").toUpperCase()) {
    case "DONE": return "ok";
    case "IN_PROGRESS": return "blue";
    case "BLOCKED": return "warn";
    default: return "mute";
  }
};

export function PortalShipment({ dossierId, onBack }: { dossierId: string; onBack?: () => void }) {
  const [chain, setChain] = React.useState<PortalChain | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setChain(null);
    setError(null);
    portalClientChain(dossierId)
      .then((c) => alive && setChain(c))
      .catch((e) => alive && setError(msg(e)));
    return () => { alive = false; };
  }, [dossierId]);

  if (error) return <ErrorState message={error} />;
  if (!chain) return <SkeletonTable />;

  const service = chain.dossier.service_en || chain.dossier.service_fr;
  const done = chain.milestones.filter((m) => m.status === "DONE").length;

  return (
    <div className="space-y-6">
      <div>
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground">
            ← All shipments
          </button>
        )}
        <h1 className="font-display text-2xl text-foreground">{chain.dossier.ref}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {service ? `${service} · ` : ""}
          {done} of {chain.milestones.length} steps complete
        </p>
      </div>

      <Panel title="Progress">
        {chain.milestones.length === 0 ? (
          <EmptyState title="Nothing to show yet" hint="Steps appear here as your file is set up." />
        ) : (
          <ol className="divide-y divide-border">
            {chain.milestones.map((m) => (
              <li key={m.code + String(m.stage_seq)} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.label_en || m.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.status === "DONE" && m.completed_at
                      ? `Completed ${dateFmt(m.completed_at)}`
                      : m.planned_due
                        ? `Expected ${dateFmt(m.planned_due)}`
                        : "Scheduled once the shipment is under way"}
                    {/* Only present at all when the forwarder has chosen to share it. */}
                    {m.forecast_due && m.planned_due && m.forecast_due !== m.planned_due
                      ? ` · now tracking ${dateFmt(m.forecast_due)}`
                      : ""}
                  </p>
                </div>
                <Pill tone={statusTone(m.status)}>{STATUS_LABEL[m.status] || m.status}</Pill>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {chain.assumptions.length > 0 && (
        <Panel title="What these dates assume">
          <p className="mb-3 text-xs text-muted-foreground">
            Your schedule depends on parties whose hours we do not control. These are the conditions it
            was built on.
          </p>
          <ul className="space-y-2">
            {chain.assumptions.map((a) => (
              <li key={a.code} className="text-sm text-muted-foreground">
                {a.text_en || a.text_fr}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

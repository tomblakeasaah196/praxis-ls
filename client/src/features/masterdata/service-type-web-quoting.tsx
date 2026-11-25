/**
 * Quoting: where a website quote for this service lands (SmartLS website v2,
 * PR 3, migration 14640).
 *
 * A published web profile is a WEBSITE SERVICE ("Sea Freight"). It quotes for
 * its own service type plus the MEMBERS picked here (Sea Freight Export,
 * End-to-End Sea Freight), and the quote engine (`@shared` quoteEngine) picks
 * one of them from what the visitor answers: their direction, their Incoterm,
 * or plain answers about where our work begins and ends. The ROUTING RULES
 * decide which: each (direction, span of the work) cell goes to the end-to-end
 * type, the direction's own type, a type named outright, or the desk.
 *
 * The panel shows the consequence before a visitor meets it: a preview of
 * where every Incoterm lands, built by the server from the same engine the
 * intake runs. Members and rules stay editable while published: they change
 * where a quote lands, not what the public page shows.
 */
import * as React from "react";
import { quoteEngine } from "@shared";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

type ServiceTypeRow = { service_type_id: string; name_en?: string | null; name_fr?: string | null; key?: string | null };

/** The work a span covers, in words a person reads. Chrome: Title Case. */
const SPAN_LABEL: Record<string, string> = {
  O: "Origin Only",
  M: "Main Carriage Only",
  D: "Destination Only",
  OM: "Origin and Main Carriage",
  MD: "Main Carriage and Destination",
  OMD: "Door to Door",
};

const OUTCOME_LABEL: Record<string, string> = {
  END_TO_END: "End to End Type",
  IMPORT: "Import Type",
  EXPORT: "Export Type",
  DESK: "Desk Review",
  TYPE: "Named Type",
};

const DIRECTION_LABEL: Record<string, string> = { IMPORT: "Importing", EXPORT: "Exporting" };

const cellKey = (direction: string, span: string) => `${direction}|${span}`;

function nameOf(rows: ServiceTypeRow[], id: string | null | undefined): string {
  if (!id) return "";
  const r = rows.find((x) => x.service_type_id === id);
  return (r && (r.name_en || r.name_fr || r.key)) || id;
}

/** The outcomes a cell may take: its direction's own flow only, never the other. */
function outcomesFor(direction: string): string[] {
  return ["END_TO_END", direction, "DESK"];
}

/* ── generic rules ──────────────────────────────────────────────────────── */

function GenericRulesDialog({
  open,
  onClose,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  canWrite: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const seed = (list: api.QuoteRouteRule[]) =>
    setRows(Object.fromEntries(list.map((r) => [cellKey(r.direction, r.span), r.outcome])));

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .getQuoteRoutingGeneric()
      .then((out) => seed(out.generic.length ? out.generic : [...quoteEngine.DEFAULT_RULES]))
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const list = quoteEngine.DIRECTIONS.flatMap((direction) =>
        quoteEngine.SPANS.map((span) => ({ direction, span, outcome: rows[cellKey(direction, span)] || "DESK" })),
      );
      await api.replaceQuoteRoutingGeneric(list);
      toast.success(tr("Generic routing saved"));
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Generic Quote Routing")}
      description={tr(
        "Where the work a visitor describes lands, for every website service that has no rule of its own for that cell. Door to door goes to the end-to-end type; otherwise to the direction's own type.",
      )}
      size="lg"
      footer={
        <>
          {canWrite && (
            <Button variant="outline" type="button" onClick={() => seed([...quoteEngine.DEFAULT_RULES])} disabled={saving}>
              {tr("Restore Defaults")}
            </Button>
          )}
          <Button variant="outline" type="button" onClick={onClose}>
            {tr("Close")}
          </Button>
          {canWrite && (
            <Button type="button" onClick={() => void save()} disabled={saving || loading} data-testid="routing-generic-save">
              {tr("Save Routing")}
            </Button>
          )}
        </>
      }
    >
      {error && <Callout tone="bad" title={tr("Could not save the routing")}>{error}</Callout>}
      <Table density="compact">
        <THead>
          <TR>
            <TH>{tr("Work")}</TH>
            <TH>{tr("Importing")}</TH>
            <TH>{tr("Exporting")}</TH>
          </TR>
        </THead>
        <TBody>
          {quoteEngine.SPANS.map((span) => (
            <TR key={span}>
              <TD>{tr(SPAN_LABEL[span])}</TD>
              {quoteEngine.DIRECTIONS.map((direction) => (
                <TD key={direction}>
                  <Select
                    aria-label={`${tr(SPAN_LABEL[span])}, ${tr(DIRECTION_LABEL[direction])}`}
                    value={rows[cellKey(direction, span)] || ""}
                    disabled={!canWrite || loading}
                    onChange={(e) => setRows((r) => ({ ...r, [cellKey(direction, span)]: e.target.value }))}
                  >
                    {outcomesFor(direction).map((o) => (
                      <option key={o} value={o}>{tr(OUTCOME_LABEL[o])}</option>
                    ))}
                  </Select>
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </Dialog>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────── */

export function ServiceTypeWebQuoting({
  serviceTypeId,
  tab,
  types,
  canWrite,
  onSaved,
}: {
  serviceTypeId: string;
  tab: api.ServiceTypeWebTab;
  types: ServiceTypeRow[];
  canWrite: boolean;
  onSaved: (next: api.ServiceTypeWebTab) => void;
}) {
  const toast = useToast();
  const members = tab.members || [];
  const routing = tab.routing;
  const [picked, setPicked] = React.useState<string[]>(() => members.map((m) => m.service_type_id));
  const [own, setOwn] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<"members" | "routing" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [genericOpen, setGenericOpen] = React.useState(false);

  const membersKey = members.map((m) => m.service_type_id).join(",");
  React.useEffect(() => {
    setPicked(membersKey ? membersKey.split(",") : []);
  }, [membersKey]);

  const ownKey = JSON.stringify(routing?.own || []);
  React.useEffect(() => {
    const next: Record<string, string> = {};
    for (const r of routing?.own || []) {
      next[cellKey(r.direction, r.span)] = r.outcome === "TYPE" ? `TYPE:${r.service_type_id}` : r.outcome;
    }
    setOwn(next);
  }, [ownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTypes = [...types].sort((a, b) => String(a.name_en || a.key).localeCompare(String(b.name_en || b.key)));
  const quoted = [serviceTypeId, ...members.map((m) => m.service_type_id)];
  const membersDirty = picked.slice().sort().join(",") !== members.map((m) => m.service_type_id).sort().join(",");
  const generic = new Map((routing?.generic || []).map((r) => [cellKey(r.direction, r.span), r.outcome]));

  async function saveMembers() {
    setBusy("members");
    setError(null);
    try {
      const next = await api.replaceServiceTypeWebMembers(serviceTypeId, picked);
      toast.success(tr("Service types saved"));
      onSaved(next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveRouting() {
    setBusy("routing");
    setError(null);
    try {
      const rows: api.QuoteRouteRule[] = [];
      for (const [k, v] of Object.entries(own)) {
        if (!v) continue;
        const [direction, span] = k.split("|");
        if (v.startsWith("TYPE:")) rows.push({ direction, span, outcome: "TYPE", service_type_id: v.slice(5) });
        else rows.push({ direction, span, outcome: v });
      }
      const next = await api.replaceServiceTypeWebRouting(serviceTypeId, rows);
      toast.success(tr("Routing saved"));
      onSaved(next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const preview = routing?.preview || [];
  const terms = [...new Set(preview.map((p) => p.incoterm))];
  const directions = [...new Set(preview.map((p) => p.direction))];
  const landing = (p: api.QuoteRoutePreview | undefined) => {
    if (!p) return "";
    if (p.outcome === "RESOLVED") return nameOf(allTypes, p.service_type_id);
    if (p.outcome === "CHOOSE") return tr("Visitor Chooses");
    return tr("Desk Review");
  };

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" data-testid="web-quoting">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{tr("Quoting")}</h3>
        <Button size="sm" variant="outline" type="button" onClick={() => setGenericOpen(true)} data-testid="routing-generic-open">
          {tr("Generic Routing")}
        </Button>
      </div>

      {error && <Callout tone="bad" title={tr("Could not save")}>{error}</Callout>}
      {(tab.engine_warnings || []).length > 0 && (
        <Callout tone="warn" title={tr("Check the routing")}>
          <ul className="list-disc pl-4">
            {(tab.engine_warnings || []).map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </Callout>
      )}

      <Field
        label={tr("Service Types Quoted")}
        about={tr(
          "A visitor asks for this service; the quote lands on one of these types. This service's own type is always included. A type can stand under one website service only.",
        )}
      >
        <div className="grid gap-1 sm:grid-cols-2" data-testid="web-members">
          <Checkbox checked disabled label={`${nameOf(allTypes, serviceTypeId) || tab.service_type.name_en || ""} (${tr("this service")})`} onCheckedChange={() => {}} />
          {allTypes
            .filter((t) => t.service_type_id !== serviceTypeId)
            .map((t) => (
              <Checkbox
                key={t.service_type_id}
                checked={picked.includes(t.service_type_id)}
                disabled={!canWrite}
                label={t.name_en || t.name_fr || t.key || t.service_type_id}
                onCheckedChange={(on) =>
                  setPicked((ids) => (on ? [...ids, t.service_type_id] : ids.filter((x) => x !== t.service_type_id)))
                }
              />
            ))}
        </div>
        {canWrite && (
          <div className="mt-2">
            <Button size="sm" type="button" disabled={!membersDirty || busy !== null} onClick={() => void saveMembers()} data-testid="web-members-save">
              {tr("Save Types")}
            </Button>
          </div>
        )}
      </Field>

      {routing && routing.kind === "FREIGHT" && preview.length > 0 && (
        <Field
          label={tr("Where Each Incoterm Lands")}
          about={tr(
            "What a visitor who knows their Incoterm is quoted under, by the same engine the website runs. Plain answers that describe the same work land in the same place.",
          )}
        >
          <Table density="compact" data-testid="web-routing-preview">
            <THead>
              <TR>
                <TH>{tr("Incoterm")}</TH>
                {directions.map((d) => <TH key={d}>{tr(DIRECTION_LABEL[d] || d)}</TH>)}
              </TR>
            </THead>
            <TBody>
              {terms.map((term) => (
                <TR key={term}>
                  <TD className="font-mono">{term}</TD>
                  {directions.map((d) => {
                    const p = preview.find((x) => x.incoterm === term && x.direction === d);
                    return (
                      <TD key={d}>
                        {p?.outcome === "RESOLVED" ? landing(p) : <Pill tone="warn">{landing(p)}</Pill>}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </Field>
      )}

      {routing && routing.kind === "FREIGHT" && (
        <Field
          label={tr("This Service's Own Rules")}
          about={tr(
            "Leave a cell on Generic to follow the generic routing. Change it to send that work somewhere else for this service only: one of its types, or the desk.",
          )}
        >
          <Table density="compact" data-testid="web-routing-own">
            <THead>
              <TR>
                <TH>{tr("Work")}</TH>
                {quoteEngine.DIRECTIONS.map((d) => <TH key={d}>{tr(DIRECTION_LABEL[d])}</TH>)}
              </TR>
            </THead>
            <TBody>
              {quoteEngine.SPANS.map((span) => (
                <TR key={span}>
                  <TD>{tr(SPAN_LABEL[span])}</TD>
                  {quoteEngine.DIRECTIONS.map((direction) => {
                    const k = cellKey(direction, span);
                    const g = generic.get(k);
                    return (
                      <TD key={direction}>
                        <Select
                          aria-label={`${tr(SPAN_LABEL[span])}, ${tr(DIRECTION_LABEL[direction])}`}
                          value={own[k] || ""}
                          disabled={!canWrite}
                          onChange={(e) => setOwn((o) => ({ ...o, [k]: e.target.value }))}
                        >
                          <option value="">{`${tr("Generic")}: ${g ? tr(OUTCOME_LABEL[g]) : tr("Desk Review")}`}</option>
                          {outcomesFor(direction).map((o) => (
                            <option key={o} value={o}>{tr(OUTCOME_LABEL[o])}</option>
                          ))}
                          {quoted.map((id) => (
                            <option key={id} value={`TYPE:${id}`}>{nameOf(allTypes, id)}</option>
                          ))}
                        </Select>
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
          {canWrite && (
            <div className="mt-2">
              <Button size="sm" type="button" disabled={busy !== null} onClick={() => void saveRouting()} data-testid="web-routing-save">
                {tr("Save Routing")}
              </Button>
            </div>
          )}
        </Field>
      )}

      <GenericRulesDialog open={genericOpen} onClose={() => setGenericOpen(false)} canWrite={canWrite} />
    </section>
  );
}

export default ServiceTypeWebQuoting;

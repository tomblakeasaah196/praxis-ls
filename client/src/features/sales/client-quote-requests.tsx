/**
 * A client's quote requests, on its Client 360 (tenant review, meeting 6, item
 * 2.7): every request linked to the client — keyed in here, sent from their
 * portal, or matched from the website or an email — and "New quote request"
 * with the client already filled in and the requester taken from the contact
 * picked beside the button.
 *
 * A row opens the request's own 360 (`/sales/quote-requests/:id`): that is
 * where it is worked, so this tab stays a list and never a second editor.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Select as NativeSelect } from "@/components/ui/modal";
import { Pill, statusTone } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { MiniTable, Th, Td } from "@/features/masterdata/mini-table";
import { useResource } from "@/lib/use-resource";
import { dateFmt, enumLabel } from "@/lib/format";
import { clientQuoteRequests, serviceNameOf } from "@/lib/quote-request-api";
import { QuoteRequestForm } from "./quote-request-forms";

type Contact = { contact_id: string; name: string; email?: string | null; phone?: string | null; is_primary?: boolean; is_active?: boolean };

export function ClientQuoteRequestsTab({
  clientId,
  clientName,
  contacts,
  canCreate,
}: {
  clientId: string;
  clientName: string;
  contacts: readonly Contact[];
  /** MOD-20 create — the button is hidden rather than refused. */
  canCreate: boolean;
}) {
  const list = useResource(() => clientQuoteRequests(clientId), [clientId]);
  const people = React.useMemo(
    () => contacts.filter((c) => c.is_active !== false).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary)),
    [contacts],
  );
  const [contactId, setContactId] = React.useState("");
  React.useEffect(() => {
    if (!contactId && people[0]) setContactId(people[0].contact_id);
  }, [people, contactId]);
  const [creating, setCreating] = React.useState(false);
  const contact = people.find((c) => c.contact_id === contactId) || null;
  const rows = list.data || [];
  // Memoised: the form re-seeds whenever `initial` changes identity, so a fresh
  // object per render would wipe what the user has typed on any re-render here.
  const initial = React.useMemo(
    () => ({
      client_id: clientId,
      client_name: clientName,
      requester_company: clientName,
      requester_name: contact?.name ?? null,
      requester_email: contact?.email ?? null,
      requester_phone: contact?.phone ?? null,
    }),
    [clientId, clientName, contact],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{tr("Quote requests")}</h4>
          <p className="micro">{tr("Every request for this client — from the desk, their portal, the website or an email.")}</p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap items-end gap-2">
            {people.length ? (
              <label className="grid gap-1 text-xs text-muted-foreground">
                {tr("Requester")}
                <NativeSelect value={contactId} onChange={(e) => setContactId(e.target.value)} className="h-9 min-w-[12rem]">
                  {people.map((c) => (
                    <option key={c.contact_id} value={c.contact_id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
            <Button size="sm" onClick={() => setCreating(true)}>
              {tr("New quote request")}
            </Button>
          </div>
        ) : null}
      </div>

      {list.error ? (
        <ErrorState message={list.error} />
      ) : list.loading && !list.data ? (
        <LoadingRow label={tr("Loading quote requests…")} />
      ) : rows.length === 0 ? (
        <EmptyState title={tr("No quote requests yet")} hint={tr("Requests this client sends from their portal appear here, as do the ones keyed in for them.")} />
      ) : (
        <MiniTable
          empty={false}
          head={
            <>
              <Th>{tr("Reference")}</Th>
              <Th>{tr("Service")}</Th>
              <Th>{tr("Requester")}</Th>
              <Th>{tr("Status")}</Th>
              <Th>{tr("Received")}</Th>
            </>
          }
        >
          {rows.map((r) => {
            const id = String(r.quote_request_id);
            const service = serviceNameOf({ name_en: r.service_name_en as string | null, name_fr: r.service_name_fr as string | null });
            return (
              <tr key={id}>
                <Td>
                  <Link to={`/sales/quote-requests/${encodeURIComponent(id)}`} className="font-mono text-primary-ink underline underline-offset-2 hover:opacity-80">
                    {String(r.public_ref || id.slice(0, 8))}
                  </Link>
                </Td>
                <Td>{service || String(r.service_category || "—")}</Td>
                <Td>{String(r.requester_name || "—")}</Td>
                <Td>
                  <Pill tone={statusTone(String(r.status || ""))}>{tr(enumLabel(String(r.status || "")))}</Pill>
                </Td>
                <Td>{dateFmt(r.created_at as string | null)}</Td>
              </tr>
            );
          })}
        </MiniTable>
      )}

      {creating ? (
        <QuoteRequestForm
          open
          editing={null}
          initial={initial}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Service type 360 → Commercial.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────────
 *
 * The tab used to show three things: a per-currency money rollup, the 25 most
 * recent margin simulations and the 25 most recent FINAL invoices. Everything
 * else a service type generates in money terms was absent — the quotations
 * that sold it, the proforma between quote and invoice, the credit notes that
 * reduce the revenue figure, what was actually collected against it, the
 * costing sheets behind the planned number, the cash it consumes before it
 * bills, and the suppliers paid to deliver it.
 *
 * All eleven are here now, and every one of them PAGES SERVER-SIDE at 25. That
 * is the part that could not be bolted onto the old shape: the /360 endpoint
 * returns the whole page in one payload, so adding eight collections to it
 * would have made every tab of the dossier pay for a tab most readers never
 * open, and still capped each at "25 most recent, 4,117 not listed here".
 *
 * ── THE THREE SUB-TABS ──────────────────────────────────────────────────────
 *
 * Eleven paginated tables on one page is a scroll, not a report, so they are
 * grouped by what the reader is asking:
 *
 *   SELL    did we win it, and at what price
 *   BILL    did we invoice it, and did the money arrive
 *   SPEND   what did it cost us, planned and actual
 *
 * The grouping is the SERVER's (`BLOCK_GROUP` in
 * service_type_commercial.service.js), not a second copy here, and the active
 * sub-tab is in `?sub=` so a reader can send someone the Bill view directly.
 * Only the blocks of the open sub-tab are mounted, so opening Commercial costs
 * one summary call plus three or five row calls, never eleven.
 *
 * ── MONEY RULES THIS SCREEN KEEPS ───────────────────────────────────────────
 *
 * 1. NOTHING IS CONVERTED. Every tile reads XAF and says so in its label; the
 *    other currencies are behind the ⓘ beside the strip. The server keeps them
 *    apart for the reason moneyRollup gives, and a tile that folded EUR into
 *    XAF at today's rate would also change its own history every morning.
 * 2. A REFUSAL IS NOT A ZERO. Each block is gated on the module that owns it,
 *    and a block this reader may not open says so instead of rendering an
 *    empty table. `allowed: false` and "nothing here yet" look identical as a
 *    blank table and mean opposite things.
 * 3. THE TOTAL IS THE SERVER'S. Both the row count under each table and the
 *    per-currency subtotal come from the endpoint, never from counting the
 *    rows on the loaded page — which is the defect `<Pagination>`'s own header
 *    comment was written about.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useNavigate } from "react-router-dom";
import { Pill } from "@/components/ui/pill";
import { InfoHint } from "@/components/ui/info-hint";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pagination } from "@/components/ui/pagination";
import { SectionTabs } from "@/components/ui/section-tabs";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { MiniTable, Th, Td } from "./mini-table";
import { ResponsiveList, RecordCard } from "@/components/ui/responsive-list";
import { useListPaged, useResource } from "@/lib/use-resource";
import { useUrlTab } from "@/lib/use-url-tab";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";

/* ── Sub-tabs ─────────────────────────────────────────────────────────────── */

/** Registered in `client/src/app/screen-registry.json` against THIS file —
 *  `npm run check:search` fails a URL-addressable tab that is not. */
const COMMERCIAL_SUBTABS = ["Sell", "Bill", "Spend"] as const;
type SubTab = (typeof COMMERCIAL_SUBTABS)[number];

/** `?sub=`, not `?tab=` — the dossier's own tab strip already owns `?tab=`, so
 *  a shared key would make picking Bill jump out of Commercial entirely.
 *  Hoisted to a const so the `useUrlTab(...)` call carries no string literal:
 *  the search gate reads every literal in that call as a tab value. */
const SUB_PARAM = "sub";

const SUB_OF_GROUP: Record<api.CommercialGroup, SubTab> = {
  sell: "Sell",
  bill: "Bill",
  spend: "Spend",
};

/* ── Small shared pieces ──────────────────────────────────────────────────── */

/** A deep link out to the module that owns the row. Same convention as the
 *  rest of the 360s: the target module stays authoritative rather than having
 *  its detail stacked in a modal over this one. */
function DeepLink({ href, children }: { href: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="text-primary-ink underline underline-offset-2 hover:opacity-80 focus-visible:outline-none"
      onClick={() => navigate(href)}
    >
      {children}
    </button>
  );
}

/** A file reference, or an em-dash placeholder when the document has no file. */
function FileCell({ ref_ }: { ref_?: string | null }) {
  if (!ref_) return <>—</>;
  return (
    <DeepLink href={`/operations/files?ref=${encodeURIComponent(ref_)}`}>{ref_}</DeepLink>
  );
}

/** A document number that opens its own record, falling back to a short id for
 *  a draft that has not been allocated one yet. */
function DocCell({ href, number, id }: { href: string; number?: string | null; id: string }) {
  return <DeepLink href={href}>{number || id.slice(0, 8)}</DeepLink>;
}

const pct = (v: unknown) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
    ? "—"
    : `${Number(v).toFixed(1)}%`;

/**
 * The per-currency subtotal under a block's heading.
 *
 * Rendered as plain spans rather than a second table: it is one line per
 * currency and almost always one line in total, and a two-row table above a
 * twenty-five-row table reads as a second header.
 */
function Subtotal({
  totals,
  columns,
}: {
  totals: api.CommercialTotal[] | null;
  columns: { key: string; label: string; money?: boolean }[];
}) {
  if (!totals || totals.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-label text-muted-foreground">
      {totals.map((t) => (
        <span key={t.currency} className="tabular-nums">
          <span className="font-medium text-foreground">{t.currency}</span>{" "}
          {columns
            .map((c) =>
              c.money === false
                ? `${tr(c.label)} ${num(Number(t[c.key] ?? 0))}`
                : `${tr(c.label)} ${money(t[c.key], t.currency)}`,
            )
            .join(" · ")}
        </span>
      ))}
    </div>
  );
}

/* ── One block ────────────────────────────────────────────────────────────── */

/** What a block renders. `row` is typed to that block's own row shape; `spec`
 *  below erases it exactly once so the eleven can live in one map. */
type BlockSpec<T> = {
  /** Chrome, so Title Case — `npm run check:prose` checks the strip and the
   *  registry, and a heading that names a thing is a name. */
  title: string;
  /** Where the rows live. The label is the link text. */
  link: { href: string; label: string };
  /** A message, so sentence case. Says what is absent, in the reader's words. */
  empty: string;
  head: React.ReactNode;
  row: (r: T) => React.ReactNode;
  /**
   * The PHONE rendering of one row (FRONTEND_GUIDE §3.16, and the note at the
   * top of mini-table.tsx: "Desktop only. Pair it with `<ResponsiveList>` and
   * a `<RecordCard>`").
   *
   * Not optional. A money table is six or seven columns wide, and the one it
   * replaced already scrolled sideways on a tablet — which is where this
   * product's operations people actually read it. Eleven of them would have
   * made that the normal way to use the tab.
   */
  card: (r: T) => React.ReactNode;
  /** Which columns of the server's per-currency subtotal to print. */
  subtotal?: { key: string; label: string; money?: boolean }[];
};

/**
 * The one cast in this file.
 *
 * Each spec below is written against its own row type and checked as such; the
 * generic block component renders a list it cannot name the element type of,
 * because the element type depends on the block and the block is chosen at
 * runtime. Erasing it here, once, beats eleven casts at eleven call sites or a
 * `Record<string, unknown>` row that would type-check `r.totl_ttc`.
 */
function spec<T>(s: BlockSpec<T>): BlockSpec<unknown> {
  return s as BlockSpec<unknown>;
}

function CommercialBlockTable({
  serviceTypeId,
  block,
  allowed,
  gate,
  totals,
}: {
  serviceTypeId: string;
  block: api.CommercialBlock;
  allowed: boolean;
  gate: string | null;
  totals: api.CommercialTotal[] | null;
}) {
  const s = SPECS[block];
  const [page, setPage] = React.useState(0);
  // A null path keeps the hook mounted and the request unsent, which is what a
  // refused block needs: hooks cannot be called conditionally, and fetching a
  // 403 just to discard it would put an error in the console on every open.
  const list = useListPaged<unknown>(
    allowed ? api.serviceTypeCommercialPath(serviceTypeId, block) : null,
    { page, pageSize: 25 },
  );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{tr(s.title)}</h3>
        {allowed && <DeepLink href={s.link.href}>{tr(s.link.label)}</DeepLink>}
      </div>

      {!allowed ? (
        <EmptyState
          title={tr(
            gate
              ? "You do not have permission to see this. Ask an administrator for read access."
              : "You do not have permission to see this.",
          )}
        />
      ) : list.error ? (
        <ErrorState message={list.error} />
      ) : list.rows === null ? (
        <LoadingRow />
      ) : (
        <>
          {s.subtotal && <Subtotal totals={totals} columns={s.subtotal} />}
          {/* The block's OWN empty line, not MiniTable's generic "Nothing here
              yet." — which is why the table is skipped rather than handed
              `empty`. "No credit note has been raised against this service
              type" tells the reader what is absent; the generic one does not,
              and rendering both would say it twice. */}
          {list.rows.length === 0 ? (
            <EmptyState title={tr(s.empty)} />
          ) : (
            <ResponsiveList
              items={list.rows}
              renderItem={(r) => s.card(r)}
              itemClassName="list-none"
            >
              <MiniTable empty={false} head={s.head}>
                {list.rows.map((r) => (
                  <tr key={(r as { row_id: string }).row_id}>{s.row(r)}</tr>
                ))}
              </MiniTable>
            </ResponsiveList>
          )}
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}

/* ── The eleven specs ─────────────────────────────────────────────────────── */

const SPECS: Record<api.CommercialBlock, BlockSpec<unknown>> = {
  /* ── Sell ──────────────────────────────────────────────────────────────── */
  quotations: spec<api.CommercialQuotationRow>({
    title: "Quotations",
    link: { href: "/sales/quotations", label: "Open Quotations →" },
    empty: "No quotation has been raised on a file of this service type.",
    subtotal: [
      { key: "doc_count", label: "Quotes", money: false },
      { key: "total_ttc", label: "Quoted", money: true },
      { key: "won_ttc", label: "Won", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Client")}</Th>
        <Th>{tr("Status")}</Th>
        <Th>{tr("Valid until")}</Th>
        <Th r>{tr("Margin %")}</Th>
        <Th r>{tr("Total TTC")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/sales/quotations?focus=${encodeURIComponent(r.row_id)}`} number={r.doc_number} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.client_name || "—"}</Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td>{dateFmt(r.valid_until)}</Td>
        <Td r>{pct(r.margin_percent)}</Td>
        <Td r>{money(r.total_ttc, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.row_id.slice(0, 8)}
        subtitle={r.client_name}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Valid until"), dateFmt(r.valid_until)],
          [tr("Margin %"), pct(r.margin_percent)],
          [tr("Total TTC"), money(r.total_ttc, r.currency)],
        ]}
      />
    ),
  }),

  proforma: spec<api.CommercialProformaRow>({
    title: "Proforma Invoices",
    link: { href: "/finance/proformas", label: "Open Proforma →" },
    empty: "No proforma has been issued on a file of this service type.",
    subtotal: [
      { key: "doc_count", label: "Proforma", money: false },
      { key: "total_ttc", label: "Issued", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Client")}</Th>
        <Th>{tr("Status")}</Th>
        <Th>{tr("Due")}</Th>
        <Th r>{tr("Total TTC")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/finance/proformas?focus=${encodeURIComponent(r.row_id)}`} number={r.doc_number} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.client_name || "—"}</Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td>{dateFmt(r.payment_due_on)}</Td>
        <Td r>{money(r.total_ttc, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.row_id.slice(0, 8)}
        subtitle={r.client_name}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Due"), dateFmt(r.payment_due_on)],
          [tr("Total TTC"), money(r.total_ttc, r.currency)],
        ]}
      />
    ),
  }),

  margin_sims: spec<api.CommercialMarginSimRow>({
    title: "Margin Simulations",
    link: { href: "/commercial/margin-simulation", label: "Open Margin Simulation →" },
    empty: "No margin simulation has ever been filed under this service type.",
    subtotal: [
      { key: "doc_count", label: "Sims", money: false },
      { key: "total_price", label: "Price", money: true },
      { key: "total_cost", label: "Cost", money: true },
    ],
    head: (
      <>
        <Th>{tr("File")}</Th>
        <Th>{tr("Currency")}</Th>
        <Th r>{tr("Total cost")}</Th>
        <Th r>{tr("Total price")}</Th>
        <Th r>{tr("Margin %")}</Th>
        <Th>{tr("Created")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.currency}</Td>
        <Td r>{money(r.total_cost, r.currency)}</Td>
        <Td r>{money(r.total_price, r.currency)}</Td>
        <Td r>{pct(r.margin_percent)}</Td>
        <Td>{dateFmt(r.created_at)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.dossier_ref || tr("No file")}
        meta={[
          [tr("Total cost"), money(r.total_cost, r.currency)],
          [tr("Total price"), money(r.total_price, r.currency)],
          [tr("Margin %"), pct(r.margin_percent)],
          [tr("Created"), dateFmt(r.created_at)],
        ]}
      />
    ),
  }),

  extra_charges: spec<api.CommercialExtraChargeRow>({
    title: "Extra Charges",
    link: { href: "/commercial/extra-charge-simulation", label: "Open Extra-charge Simulation →" },
    empty: "No demurrage or detention has been simulated on a file of this service type.",
    subtotal: [
      { key: "doc_count", label: "Sims", money: false },
      { key: "total_amount", label: "Charges", money: true },
    ],
    head: (
      <>
        <Th>{tr("File")}</Th>
        <Th>{tr("Shipping line")}</Th>
        <Th>{tr("Container")}</Th>
        <Th r>{tr("Free days")}</Th>
        <Th>{tr("Out of port")}</Th>
        <Th r>{tr("Total")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.shipping_line || "—"}</Td>
        <Td>{r.container_variant || "—"}</Td>
        <Td r>{r.free_days == null ? "—" : num(r.free_days)}</Td>
        <Td>{dateFmt(r.out_of_port_on)}</Td>
        <Td r>{money(r.total_amount, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.shipping_line || tr("Extra Charges")}
        subtitle={r.dossier_ref}
        meta={[
          [tr("Container"), r.container_variant],
          [tr("Free days"), r.free_days == null ? null : num(r.free_days)],
          [tr("Out of port"), dateFmt(r.out_of_port_on)],
          [tr("Total"), money(r.total_amount, r.currency)],
        ]}
      />
    ),
  }),

  pricing_variance: spec<api.CommercialPricingVarianceRow>({
    title: "Pricing Variance",
    link: { href: "/commercial/pricing-variance", label: "Open Pricing Variance →" },
    empty: "No pricing variance has been computed for this service type.",
    subtotal: [
      { key: "doc_count", label: "Files", money: false },
      { key: "red_count", label: "Red", money: false },
      { key: "yellow_count", label: "Yellow", money: false },
      { key: "green_count", label: "Green", money: false },
    ],
    head: (
      <>
        <Th>{tr("File")}</Th>
        <Th>{tr("Quotation")}</Th>
        <Th r>{tr("Quoted")}</Th>
        <Th r>{tr("Actual cost")}</Th>
        <Th r>{tr("Variance %")}</Th>
        <Th>{tr("Flag")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.quotation_number || "—"}</Td>
        <Td r>{money(r.quoted_price)}</Td>
        <Td r>{money(r.actual_cost)}</Td>
        <Td r>{pct(r.variance_percent)}</Td>
        <Td>
          {r.flag ? (
            <Pill tone={r.flag === "RED" ? "bad" : r.flag === "YELLOW" ? "warn" : "ok"}>
              {r.flag}
            </Pill>
          ) : (
            "—"
          )}
        </Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.dossier_ref || r.quotation_number || r.row_id.slice(0, 8)}
        pills={
          r.flag ? (
            <Pill tone={r.flag === "RED" ? "bad" : r.flag === "YELLOW" ? "warn" : "ok"}>
              {r.flag}
            </Pill>
          ) : null
        }
        meta={[
          [tr("Quotation"), r.quotation_number],
          [tr("Quoted"), money(r.quoted_price)],
          [tr("Actual cost"), money(r.actual_cost)],
          [tr("Variance %"), pct(r.variance_percent)],
        ]}
      />
    ),
  }),

  /* ── Bill ──────────────────────────────────────────────────────────────── */
  invoices: spec<api.CommercialInvoiceRow>({
    title: "FINAL Invoices",
    link: { href: "/finance/invoices", label: "Open Finance → Invoices →" },
    empty: "No FINAL invoice has been raised on a file of this service type.",
    subtotal: [
      { key: "invoice_count", label: "Locked", money: false },
      { key: "billed_ttc", label: "Billed", money: true },
      { key: "revenue_ht", label: "Revenue HT", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Client")}</Th>
        <Th>{tr("Status")}</Th>
        <Th>{tr("Due")}</Th>
        <Th r>{tr("Total TTC")}</Th>
        <Th r>{tr("Outstanding")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/finance/invoices?focus=${encodeURIComponent(r.row_id)}`} number={r.doc_number} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.client_name || "—"}</Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td>{dateFmt(r.payment_due_on)}</Td>
        <Td r>{money(r.total_ttc, r.currency)}</Td>
        <Td r>{money(r.outstanding, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.row_id.slice(0, 8)}
        subtitle={r.client_name}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Due"), dateFmt(r.payment_due_on)],
          [tr("Total TTC"), money(r.total_ttc, r.currency)],
          [tr("Outstanding"), money(r.outstanding, r.currency)],
        ]}
      />
    ),
  }),

  credit_notes: spec<api.CommercialCreditNoteRow>({
    title: "Credit Notes",
    link: { href: "/finance/credit-notes", label: "Open Credit Notes →" },
    empty: "No credit note has been raised against this service type.",
    subtotal: [
      // "Credit Notes", not "Notes": the shared `Notes` dictionary key means
      // remarks, and renders as "Notes" in French where this needs "Avoirs".
      { key: "doc_count", label: "Credit Notes", money: false },
      { key: "credit_ttc", label: "Credited", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Client")}</Th>
        <Th>{tr("Status")}</Th>
        <Th>{tr("Created")}</Th>
        <Th r>{tr("Total TTC")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/finance/credit-notes?focus=${encodeURIComponent(r.row_id)}`} number={r.doc_number} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.client_name || "—"}</Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td>{dateFmt(r.created_at)}</Td>
        <Td r>{money(r.total_ttc, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.row_id.slice(0, 8)}
        subtitle={r.client_name}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Created"), dateFmt(r.created_at)],
          [tr("Total TTC"), money(r.total_ttc, r.currency)],
        ]}
      />
    ),
  }),

  collections: spec<api.CommercialCollectionRow>({
    title: "Collections",
    link: { href: "/finance/receivables", label: "Open Receivables →" },
    empty: "Nothing has been collected against this service type yet.",
    subtotal: [
      { key: "receipt_count", label: "Receipts", money: false },
      { key: "collected", label: "Collected", money: true },
    ],
    head: (
      <>
        <Th>{tr("Invoice")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Client")}</Th>
        <Th>{tr("Method")}</Th>
        <Th>{tr("Received")}</Th>
        <Th r>{tr("Amount")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/finance/invoices?focus=${encodeURIComponent(r.invoice_id)}`} number={r.invoice_number} id={r.invoice_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.client_name || "—"}</Td>
        <Td>{r.method}</Td>
        <Td>{dateFmt(r.received_on)}</Td>
        <Td r>{money(r.amount, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.invoice_number || r.invoice_id.slice(0, 8)}
        subtitle={r.client_name}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Method"), r.method],
          [tr("Received"), dateFmt(r.received_on)],
          [tr("Amount"), money(r.amount, r.currency)],
        ]}
      />
    ),
  }),

  /* ── Spend ─────────────────────────────────────────────────────────────── */
  costings: spec<api.CommercialCostingRow>({
    title: "Costing Sheets",
    link: { href: "/costing/costing", label: "Open Costing →" },
    empty: "No costing sheet has been opened on a file of this service type.",
    subtotal: [
      { key: "doc_count", label: "Sheets", money: false },
      { key: "planned_total", label: "Planned", money: true },
      { key: "planned_disbursement", label: "Débours", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Client")}</Th>
        <Th>{tr("Status")}</Th>
        <Th r>{tr("Planned")}</Th>
        <Th r>{tr("Of which débours")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/costing/costing/${encodeURIComponent(r.row_id)}`} number={r.doc_number} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.client_name || "—"}</Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td r>{money(r.planned_total, r.currency)}</Td>
        <Td r>{money(r.planned_disbursement, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.row_id.slice(0, 8)}
        subtitle={r.client_name}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Planned"), money(r.planned_total, r.currency)],
          [tr("Of which débours"), money(r.planned_disbursement, r.currency)],
        ]}
      />
    ),
  }),

  cash_requests: spec<api.CommercialCashRequestRow>({
    title: "Cash Requests",
    link: { href: "/costing/cash-requests", label: "Open Cash Requests →" },
    empty: "No cash has been requested on a file of this service type.",
    subtotal: [
      { key: "doc_count", label: "Requests", money: false },
      { key: "requested", label: "Requested", money: true },
      { key: "disbursed", label: "Disbursed", money: true },
      { key: "justified", label: "Justified", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Status")}</Th>
        <Th r>{tr("Requested")}</Th>
        <Th r>{tr("Disbursed")}</Th>
        <Th r>{tr("Justified")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/costing/cash-requests/${encodeURIComponent(r.row_id)}`} number={r.doc_number} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td r>{money(r.amount, r.currency)}</Td>
        <Td r>{money(r.disbursed, r.currency)}</Td>
        <Td r>{money(r.justified, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.row_id.slice(0, 8)}
        subtitle={r.dossier_ref}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("Requested"), money(r.amount, r.currency)],
          [tr("Disbursed"), money(r.disbursed, r.currency)],
          [tr("Justified"), money(r.justified, r.currency)],
        ]}
      />
    ),
  }),

  supplier_invoices: spec<api.CommercialSupplierInvoiceRow>({
    title: "Supplier Invoices",
    link: { href: "/procurement/supplier-invoices", label: "Open Supplier Invoices →" },
    empty: "No supplier invoice has been booked to a file of this service type.",
    subtotal: [
      { key: "doc_count", label: "Invoices", money: false },
      { key: "amount_ttc", label: "Purchased", money: true },
      { key: "wht_total", label: "Withheld", money: true },
    ],
    head: (
      <>
        <Th>{tr("Number")}</Th>
        <Th>{tr("File")}</Th>
        <Th>{tr("Supplier")}</Th>
        <Th>{tr("Status")}</Th>
        <Th>{tr("Due")}</Th>
        <Th r>{tr("Withheld")}</Th>
        <Th r>{tr("Total TTC")}</Th>
      </>
    ),
    row: (r) => (
      <>
        <Td>
          <DocCell href={`/procurement/supplier-invoices?focus=${encodeURIComponent(r.row_id)}`} number={r.doc_number || r.supplier_ref} id={r.row_id} />
        </Td>
        <Td><FileCell ref_={r.dossier_ref} /></Td>
        <Td>{r.supplier_name || "—"}</Td>
        <Td><Pill>{r.status}</Pill></Td>
        <Td>{dateFmt(r.due_on)}</Td>
        <Td r>{money(r.wht_total, r.currency)}</Td>
        <Td r>{money(r.amount_ttc, r.currency)}</Td>
      </>
    ),
    card: (r) => (
      <RecordCard
        title={r.doc_number || r.supplier_ref || r.row_id.slice(0, 8)}
        subtitle={r.supplier_name}
        pills={<Pill>{r.status}</Pill>}
        meta={[
          [tr("File"), r.dossier_ref],
          [tr("Due"), dateFmt(r.due_on)],
          [tr("Withheld"), money(r.wht_total, r.currency)],
          [tr("Total TTC"), money(r.amount_ttc, r.currency)],
        ]}
      />
    ),
  }),
};

/* ── The KPI strip ────────────────────────────────────────────────────────── */

/**
 * Six tiles, all XAF, with every other currency behind ONE ⓘ beside the strip.
 *
 * One ⓘ and not six: the breakdown is naturally a single table of currency
 * against figure, and six icons on six tiles is the printed-supporting-text
 * problem wearing a different hat. The ⓘ is a SIBLING of the heading it
 * explains, never a child of it — inside the heading its label joins that
 * element's accessible name and "Money" starts announcing as "Money About
 * money".
 */
function Strip({ c }: { c: api.ServiceTypeCommercial }) {
  const k = c.kpis;
  const tile = (t: api.CommercialTile) => (t.allowed ? money(t.xaf ?? 0) : tr("Restricted"));

  // Every currency named anywhere in the strip, so the breakdown has one row
  // per currency rather than one table per tile.
  const currencies = [
    ...new Set(
      [...k.quoted.by_currency, ...k.planned.by_currency, ...k.billed_net.by_currency].map(
        (r) => r.currency,
      ),
    ),
  ].sort();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-foreground">{tr("Money")}</h3>
        <InfoHint label={tr("About these figures")}>
          <div className="space-y-2">
            <p>
              {tr(
                "Each tile reads XAF only. Figures are never converted: the rate belongs to the costing that chose it.",
              )}
            </p>
            {currencies.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <Th>{tr("Currency")}</Th>
                    <Th r>{tr("Quoted")}</Th>
                    <Th r>{tr("Planned")}</Th>
                    <Th r>{tr("Billed net")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currencies.map((cur) => (
                    <tr key={cur}>
                      <Td>{cur}</Td>
                      <Td r>{money(xafOfCurrency(k.quoted.by_currency, cur, "total_ttc"), cur)}</Td>
                      <Td r>{money(xafOfCurrency(k.planned.by_currency, cur, "planned_total"), cur)}</Td>
                      <Td r>{money(xafOfCurrency(k.billed_net.by_currency, cur, "net_ttc"), cur)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </InfoHint>
      </div>

      <KpiRow stack>
        <KpiTile label={tr("Quoted (XAF)")} value={tile(k.quoted)} />
        <KpiTile
          label={tr("Win Rate")}
          value={
            !k.win_rate.allowed
              ? tr("Restricted")
              : k.win_rate.percent === null
                ? "—"
                : `${k.win_rate.percent.toFixed(0)}%`
          }
          tone={
            k.win_rate.percent !== null && k.win_rate.percent >= 50 ? "ok" : "accent"
          }
        />
        <KpiTile label={tr("Planned Cost (XAF)")} value={tile(k.planned)} />
        <KpiTile label={tr("Actual Cost (XAF)")} value={tile(k.actual)} />
        <KpiTile label={tr("Billed Net (XAF)")} value={tile(k.billed_net)} />
        <KpiTile
          label={tr("Realised Margin")}
          value={
            !k.margin.allowed
              ? tr("Restricted")
              : k.margin.percent === null
                ? "—"
                : `${k.margin.percent.toFixed(1)}%`
          }
          tone={k.margin.percent !== null && k.margin.percent < 0 ? "bad" : "accent"}
        />
      </KpiRow>
    </div>
  );
}

/** One currency's figure out of a per-currency array. */
function xafOfCurrency(rows: api.CommercialTotal[], currency: string, column: string): number {
  const row = rows.find((r) => r.currency === currency);
  return row ? Number(row[column] ?? 0) : 0;
}

/* ── The tab ──────────────────────────────────────────────────────────────── */

export function ServiceTypeCommercialTab({ serviceTypeId }: { serviceTypeId: string }) {
  const [sub, setSub] = useUrlTab(COMMERCIAL_SUBTABS, COMMERCIAL_SUBTABS[0], SUB_PARAM);
  const summary = useResource(
    () => api.getServiceTypeCommercial(serviceTypeId),
    [serviceTypeId],
  );

  if (summary.error) return <ErrorState message={summary.error} />;
  if (!summary.data) return <LoadingRow />;
  const c = summary.data;

  const blocks = c.blocks.filter((b) => SUB_OF_GROUP[b.group] === sub);

  return (
    <div className="space-y-5">
      <Strip c={c} />

      <SectionTabs
        label={tr("Commercial sections")}
        value={sub}
        onChange={setSub}
        tabs={COMMERCIAL_SUBTABS.map((v) => ({ value: v, label: tr(v) }))}
      />

      <div className="space-y-6">
        {blocks.map((b) => (
          <CommercialBlockTable
            key={b.block}
            serviceTypeId={serviceTypeId}
            block={b.block}
            allowed={b.allowed}
            gate={b.gate}
            totals={c.totals[b.block]}
          />
        ))}
      </div>
    </div>
  );
}

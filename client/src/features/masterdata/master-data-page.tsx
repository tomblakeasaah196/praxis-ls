/**
 * Master Data hub — the eight reference registries folded into one screen as
 * deep-linkable tabs (FE_DESIGN_RULES §4: build the parent, fold children in,
 * collapse the menu to a single entry). Each tab renders its existing page
 * component unchanged, so per-module RBAC, org-workflow and the API contract are
 * all unaffected — this is purely a frontend regrouping.
 *
 * Routes stay deep-linkable (`/master/<section>`), so bookmarks, screen-registry
 * and Praxis navigation ("take me to suppliers") keep working; only the nav menu
 * collapses to one "Master data" entry.
 */
import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { ClientsPage, SuppliersPage, CorporateEntitiesPage, ExpenseRatesPage, FinancialDictionaryPage } from "./pages";
import { CurrenciesPage, TaxJurisdictionsPage } from "@/features/settings/master-data-pages";
import { BankAccountsPage } from "@/features/settings/config-pages";

type Tab = { key: string; label: string; Component: React.ComponentType };

const TABS: Tab[] = [
  { key: "clients", label: "Clients", Component: ClientsPage },
  { key: "suppliers", label: "Suppliers", Component: SuppliersPage },
  { key: "corporate-entities", label: "Corporate entities", Component: CorporateEntitiesPage },
  { key: "treasury-accounts", label: "Treasury", Component: BankAccountsPage },
  { key: "currencies", label: "Currencies", Component: CurrenciesPage },
  { key: "expense-rates", label: "Expense rates", Component: ExpenseRatesPage },
  { key: "financial-dictionary", label: "Financial dictionary", Component: FinancialDictionaryPage },
  { key: "tax-jurisdictions", label: "Tax", Component: TaxJurisdictionsPage },
];

export function MasterDataPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = TABS.find((t) => t.key === section) || TABS[0];
  const Active = active.Component;

  return (
    <div className="animate-fade-in">
      <div className="mx-auto mb-6 max-w-6xl">
        <div className="micro mb-2">Master data</div>
        <div className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => navigate(`/master/${t.key}`)}
              className={cn(
                "relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                active.key === t.key
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Each tab renders its own <section> (header + New action + KPIs + table). */}
      <Active />
    </div>
  );
}

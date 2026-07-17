import { TabbedHub } from "@/components/tabbed-hub";
import { CostingPage, CostTrackingPage, CashRequestsPage, RegiePage } from "./pages";

export function CostingHub() {
  return (
    <TabbedHub
      eyebrow="Costing"
      basePath="/costing"
      tabs={[
        { key: "costing", label: "Costing", Component: CostingPage },
        { key: "cost-tracking", label: "Cost tracking", Component: CostTrackingPage },
        { key: "cash-requests", label: "Cash requests", Component: CashRequestsPage },
        { key: "regie", label: "Régie", Component: RegiePage },
      ]}
    />
  );
}

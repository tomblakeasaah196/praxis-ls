import { TabbedHub } from "@/components/tabbed-hub";
import { PurchaseRequestsPage, PurchaseOrdersPage, GoodsReceivedPage, SupplierInvoicesPage } from "./pages";

export function ProcurementHub() {
  return (
    <TabbedHub
      eyebrow="Procurement"
      basePath="/procurement"
      tabs={[
        { key: "purchase-requests", label: "Requests", Component: PurchaseRequestsPage },
        { key: "purchase-orders", label: "Purchase orders", Component: PurchaseOrdersPage },
        { key: "goods-received", label: "Goods received", Component: GoodsReceivedPage },
        { key: "supplier-invoices", label: "Supplier invoices", Component: SupplierInvoicesPage },
      ]}
    />
  );
}

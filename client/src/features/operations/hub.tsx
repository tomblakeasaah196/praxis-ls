import { TabbedHub } from "@/components/tabbed-hub";
import { OperationsFilesPage, MilestonesPage, TransitOrdersPage, DeliveryNotesPage } from "./pages";

export function OperationsHub() {
  return (
    <TabbedHub
      eyebrow="Operations"
      basePath="/operations"
      tabs={[
        { key: "files", label: "Files", Component: OperationsFilesPage },
        { key: "milestones", label: "Milestones", Component: MilestonesPage },
        { key: "transit-orders", label: "Transit orders", Component: TransitOrdersPage },
        { key: "delivery-notes", label: "Delivery notes", Component: DeliveryNotesPage },
      ]}
    />
  );
}

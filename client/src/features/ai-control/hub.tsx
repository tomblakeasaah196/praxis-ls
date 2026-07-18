import { TabbedHub } from "@/components/tabbed-hub";
import { AiFeaturesPage, AiGrantsPage, AiBudgetPage, AiVendorsPage, AiUsagePage } from "./pages";

export function AiControlHub() {
  return (
    <TabbedHub
      eyebrow="AI Control"
      basePath="/ai-control"
      tabs={[
        { key: "features", label: "Features", Component: AiFeaturesPage },
        { key: "access", label: "Access", Component: AiGrantsPage },
        { key: "budget", label: "Budget", Component: AiBudgetPage },
        { key: "vendors", label: "Vendors", Component: AiVendorsPage },
        { key: "usage", label: "Usage", Component: AiUsagePage },
      ]}
    />
  );
}

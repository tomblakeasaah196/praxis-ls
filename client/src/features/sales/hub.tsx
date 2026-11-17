/** Sales & CRM — one hub, deep-linkable tabs (old /sales/<screen> paths resolve
 *  as sections). */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { LeadsPage } from "./leads";
import { EnquiriesPage } from "./enquiries";
import { QuoteRequestsPage } from "./quote-requests";
import { OpportunitiesPage } from "./opportunities";
import { ProposalsPage } from "./proposals";
import { QuotationsPage } from "@/features/commercial/quotations";
import { CompanyProfilePage } from "./company-profile";
import { MeetingsPage } from "./meetings";
import { SuccessStoriesPage } from "./success-stories";

export function SalesHub() {
  return (
    <TabbedHub
      eyebrow="Sales & CRM"
      basePath="/sales"
      tabs={hubTabs("/sales", {
        leads: LeadsPage,
        enquiries: EnquiriesPage,
        "quote-requests": QuoteRequestsPage,
        opportunities: OpportunitiesPage,
        proposals: ProposalsPage,
        quotations: QuotationsPage,
        "company-profile": CompanyProfilePage,
        meetings: MeetingsPage,
        "success-stories": SuccessStoriesPage,
      })}
    />
  );
}

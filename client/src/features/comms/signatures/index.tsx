/**
 * Company Mail → Signatures (administrators).
 *
 * The company's signature: one layout and one motto (`TemplatesTab`), with
 * three things an administrator does once in a while behind the section's own
 * controls: generating signatures for several people, choosing which brand
 * colour paints which part of the card, and checking why a card image is
 * missing from sent mail.
 *
 * ── WHERE THE SIGNATURES TAB WENT ───────────────────────────────────────────
 *
 * Signatures was a tab of Comms with four sub-tabs (My Signature, Batch,
 * Templates, Delivery Check), and Settings carried a second Email Signatures
 * screen that did part of the same job. The tenant review of 16 Nov 2026
 * folded all of it into Setup:
 *
 *   My Signature     a section of the My Mailbox tab (`DesignerTab`), because
 *                    it is the caller's own, like the mailbox above it.
 *   Templates        this section, as one layout dropdown and one motto.
 *   Card colours     the section's menu, in a dialog.
 *   Batch            the "Generate for Staff" button here, in a dialog.
 *   Delivery Check   the section's menu, in a dialog. It is a diagnostic.
 *
 * `/comms/signatures` and `/settings/email-signatures` both redirect to Setup
 * with their query string, so the server's "fix this field" links still land.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { MoreMenu } from "@/components/ui/more-menu";
import { Panel } from "@/components/ui/panel";
import { tr } from "@/lib/i18n";
import { useCan } from "@/lib/route-access";
import { AccentRoles } from "./accent-roles";
import { BatchTab } from "./batch-tab";
import { DeliveryTab } from "./delivery-tab";
import { TemplatesTab } from "./templates-tab";

export function SignaturesSection() {
  const [batch, setBatch] = React.useState(false);
  const [check, setCheck] = React.useState(false);
  const [colours, setColours] = React.useState(false);
  // The section is offered on a mail grant (MOD-72 edit); the signature routes
  // ask MOD-70. The ZIP is a download, and its route still asks `edit`.
  const can = useCan("MOD-70");

  return (
    <Panel
      title={tr("Signatures")}
      action={
        <span className="flex items-center gap-2">
          {can("edit") && (
            <Button size="sm" variant="outline" onClick={() => setBatch(true)}>
              {tr("Generate for Staff")}
            </Button>
          )}
          <MoreMenu label={tr("Signature actions")}>
            {can("edit") && (
              <DropdownItem onSelect={() => setColours(true)}>{tr("Card Colours")}</DropdownItem>
            )}
            <DropdownItem onSelect={() => setCheck(true)}>{tr("Delivery Check")}</DropdownItem>
          </MoreMenu>
        </span>
      }
    >
      <TemplatesTab />

      {batch && (
        <Dialog
          open
          onClose={() => setBatch(false)}
          title={tr("Generate Signatures for Staff")}
          size="xl"
        >
          <BatchTab />
        </Dialog>
      )}
      {colours && (
        <Dialog open onClose={() => setColours(false)} title={tr("Card Colours")} size="lg">
          <AccentRoles />
        </Dialog>
      )}
      {check && (
        <Dialog open onClose={() => setCheck(false)} title={tr("Delivery Check")} size="lg">
          <DeliveryTab />
        </Dialog>
      )}
    </Panel>
  );
}

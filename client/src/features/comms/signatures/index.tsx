/**
 * Company Mail → Signatures (administrators).
 *
 * Which signature template each part of the company gets, with two things an
 * administrator does once in a while behind the section's own controls:
 * generating signatures for several people, and checking why a card image is
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
 *   Templates        this section.
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
import { BatchTab } from "./batch-tab";
import { DeliveryTab } from "./delivery-tab";
import { TemplatesTab } from "./templates-tab";

export function SignaturesSection() {
  const [batch, setBatch] = React.useState(false);
  const [check, setCheck] = React.useState(false);

  return (
    <Panel
      title={tr("Signatures")}
      action={
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setBatch(true)}>
            {tr("Generate for Staff")}
          </Button>
          <MoreMenu label={tr("Signature actions")}>
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
      {check && (
        <Dialog open onClose={() => setCheck(false)} title={tr("Delivery Check")} size="lg">
          <DeliveryTab />
        </Dialog>
      )}
    </Panel>
  );
}

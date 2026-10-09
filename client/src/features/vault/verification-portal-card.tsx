/**
 * The verification portal, as staff see it.
 *
 * ── WHAT THIS CARD IS NOT, ANY MORE ────────────────────────────────────────
 *
 * It used to be a button that opened `/verify` INSIDE the ERP, which was wrong
 * twice. The portal is a stranger-facing surface: it belongs on the tenant's
 * own public website, and it now lives there (public-web/src/features/verify).
 * And an "Open" button is not what anybody needed from this screen, because a
 * staff member is never the one verifying. They already issued the document.
 *
 * The question an operator actually arrives with is the one a counterparty just
 * asked them down the phone: *how do I check this is genuine?* So the card's job
 * is to hand over the address, in the form the operator is going to send it.
 *
 * ── WHY THE URL IS FETCHED AND NOT BUILT HERE ──────────────────────────────
 *
 * It is NOT `window.location.origin`. The portal is on the tenant's public
 * website when they have one, and on this workspace host when they do not; the
 * row that decides lives in the platform database. The endpoint resolves it
 * through the same function that builds the URL printed inside every QR
 * (`services/signatures/verify-link.js`), so what an operator reads out here
 * and what a customs officer scans off the paper cannot disagree.
 */
import { tr, tv } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

type Portal = { url: string };

/**
 * The sentence that travels with the link.
 *
 * Written as an instruction to the RECIPIENT, not as a description of a
 * feature, because it is pasted into a WhatsApp thread or an email and read by
 * somebody who did not ask for a product tour. It names the one thing they have
 * to do: find the code under the QR and type it.
 *
 * No em dash, per the house rule, and none is wanted here anyway: the second
 * clause is an instruction rather than an aside, so it is a second sentence.
 */
const shareText = (url: string) =>
  tv(
    "You can check that any document we issued is genuine. Open {{url}} and enter the twelve-character code printed beneath the QR code on the document.",
    { url },
  );

export function VerificationPortalCard() {
  const toast = useToast();
  const { data, loading } = useResource<Portal>(
    () => tenant<Portal>("/signatures/portal"),
    [],
  );
  const url = data?.url || "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tr("Link copied."));
    } catch {
      /* @silent:permission — clipboard access is refused outright in some
         embedded webviews, and there is a working manual path: the field beside
         this button is selectable and the message says so. */
      toast.error(tr("The link could not be copied. Select it and copy it yourself."));
    }
  }

  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

  return (
    <Panel
      title={tr("Verification Portal")}
      action={
        /* The ⓘ IS A SIBLING of the heading, never a child of it. `Panel`'s
           `title` is a ReactNode, so putting the icon in there would fold its
           aria-label into the <h2>'s accessible name and the heading would
           announce as "Verification Portal About the Verification Portal".
           §3.17. */
        <InfoHint label="About the Verification Portal">
          {tr(
            "Every signed document prints a QR code with a twelve-character code beneath it. The QR opens this page on your public website. Who has checked a given document is recorded on the signature itself.",
          )}
        </InfoHint>
      }
    >
      {/* WHAT THE PORTAL GUARANTEES, KEPT ON THE PAGE.
        *
        * This is the reason anyone trusts a signed document from this vault,
        * which makes it a guarantee rather than an explanation. How the check
        * works is explanation and sits behind the ⓘ above. §3.17's ladder. */}
      {/* @prose:keep what a counterparty can verify without an account. */}
      <p className="text-sm text-muted-foreground">
        {tr(
          "Anyone holding the paper can check it without an account: the page shows what was signed, by whom, and whether the record has changed since.",
        )}
      </p>

      <div className="mt-4 space-y-3">
        {loading ? (
          <Skeleton className="h-10" />
        ) : (
          <Input
            value={url}
            readOnly
            aria-label={tr("Verification Portal Address")}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-sm"
          />
        )}

        {/* Disabled until the address has resolved: a share button that sends
            an empty link is worse than one that waits a beat. */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!url} onClick={() => void copy()}>
            {tr("Copy link")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!url}
            onClick={() => open(`https://wa.me/?text=${encodeURIComponent(shareText(url))}`)}
          >
            {tr("Send on WhatsApp")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!url}
            onClick={() =>
              open(
                `mailto:?subject=${encodeURIComponent(
                  tr("Authenticate our documents"),
                )}&body=${encodeURIComponent(shareText(url))}`,
              )
            }
          >
            {tr("Send by email")}
          </Button>
          <Button size="sm" variant="ghost" disabled={!url} onClick={() => open(url)}>
            {tr("Open")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

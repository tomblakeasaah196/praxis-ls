/**
 * "Getting started" — what an empty LIVE shows instead of a wall of zeros
 * (meeting 6, register 3.9: "my live is not working").
 *
 * LIVE only, and only until the first operations file exists; never in TEST.
 * The server decides both (GET /dashboard/getting-started reads the schema
 * the connection is pinned to), and the tower asks only when it is not in
 * TEST, so neither half alone can put this in front of a sandbox.
 *
 * Every item's state comes from the tenant's own data — nothing is ticked by
 * hand — and every item opens the screen that does it.
 */
import { Link } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";
import type { GettingStarted } from "../use-getting-started";

export function GettingStartedPanel({ data }: { data: GettingStarted }) {
  const done = data.items.filter((i) => i.done).length;
  return (
    <section
      aria-labelledby="getting-started-title"
      className="mb-4 rounded-xl border bg-card p-5 lg:mb-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="getting-started-title"
          className="text-lg font-semibold text-foreground"
        >
          {tr("Getting started")}
        </h2>
        <p className="micro">
          {done}/{data.items.length} {tr("done")}
        </p>
      </div>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {tr(
          "Your live workspace has no operations file yet, so there is nothing to track. These steps get it ready; this list goes away once the first file is open.",
        )}
      </p>
      <ol className="mt-4 divide-y divide-border rounded-lg border">
        {data.items.map((i) => (
          <li key={i.key}>
            <Link
              to={i.to}
              className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                  i.done
                    ? "border-ok/40 bg-ok-fill/10 text-ok"
                    : "border-border text-muted-foreground",
                )}
              >
                {i.done ? <CheckIcon width={14} height={14} /> : null}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1",
                  i.done
                    ? "text-muted-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {tr(i.label)}
              </span>
              <span className="micro">{i.done ? tr("Done") : tr("To do")}</span>
              <span className="sr-only">
                {i.done ? tr("Done") : tr("To do")}
              </span>
              <ArrowRightIcon
                aria-hidden
                width={14}
                height={14}
                className="text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

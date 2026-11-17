/**
 * SMTP fix-guide components — render the "how to fix this" panel for an
 * outbound-mail failure wherever it surfaces. Registry + sniffing live in
 * lib/smtp-errors.ts (SMTP_GUIDES, smtpCodeFor) so the machine-code → steps
 * mapping is testable on its own.
 *
 * `<SmtpErrorGuide />` is the collapsible guide for ONE failure; render it
 * directly UNDER the error state. There was also an always-visible
 * troubleshooting card for the setup screen; it went with the Setup clean-up of
 * 16 Nov 2026, because this guide already appears beside the error it is about.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { smtpCodeFor, smtpGuideFor } from "@/lib/smtp-errors";

/* Collapsible "How to fix this" panel — render directly UNDER the error state. */
export function SmtpErrorGuide({
  err,
  code,
  message,
  open = false,
  className,
}: {
  err?: unknown;
  code?: unknown;
  message?: unknown;
  open?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(open);
  const resolved = code
    ? String(code)
    : smtpCodeFor(err, message != null ? String(message) : undefined);
  const guide = smtpGuideFor(resolved);
  if (!guide) return null;
  return (
    <details
      open={isOpen}
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
      className={cn(
        "mt-2 rounded-lg border border-border bg-muted/40 text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2.5 py-2 font-medium text-foreground">
        <span aria-hidden>🛠</span> How to fix this — {guide.title}
        <span
          className={cn(
            "ml-auto text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
          aria-hidden
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-border/60 px-3 py-2.5">
        <p className="mb-2">{guide.intro}</p>
        <ol className="list-decimal space-y-1 pl-4">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}

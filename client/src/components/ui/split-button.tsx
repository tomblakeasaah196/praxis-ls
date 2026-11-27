/**
 * SplitButton: one primary action, with its close relatives behind a ▾.
 *
 * Reply with Reply All and Forward behind it; Send with Send Later behind it.
 * The pattern exists because the relatives are real, occasional choices that
 * cost a whole button each when drawn side by side, and on a phone they wrap
 * the strip to a second row (tenant review, 27 Nov 2026).
 *
 * Two real buttons, not one with a hot zone: the main half and the ▾ are each
 * focusable, each named, and each reachable by Tab. The ▾ opens a
 * `<DropdownMenu>`, so its items are `<DropdownItem>`s and keyboard handling is
 * Radix's. `menuLabel` names the ▾ ("More reply options"), because an
 * icon-only trigger with no name is announced as "button".
 *
 * @example
 * <SplitButton label={tr("Reply")} icon={<ReplyIcon />} onClick={reply}
 *              menuLabel={tr("More reply options")}>
 *   <DropdownItem onSelect={replyAll}>{tr("Reply All")}</DropdownItem>
 *   <DropdownItem onSelect={forward}>{tr("Forward")}</DropdownItem>
 * </SplitButton>
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ChevronIcon } from "@/components/ui/icons";

export function SplitButton({
  label,
  icon,
  onClick,
  menuLabel,
  children,
  variant = "default",
  size = "sm",
  disabled,
  loading,
  type = "button",
  title,
  className,
  mainClassName,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  /** The accessible name of the ▾ and of the menu it opens. */
  menuLabel: string;
  /** `<DropdownItem>`s. */
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: Exclude<ButtonProps["size"], "icon">;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
  /** Classes for the main half, e.g. `flex-1` to let it take the row. */
  mainClassName?: string;
}) {
  return (
    <div className={cn("inline-flex items-stretch", className)}>
      <Button
        type={type}
        variant={variant}
        size={size}
        icon={icon}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        title={title}
        className={cn("rounded-r-none", mainClassName)}
      >
        {label}
      </Button>
      <DropdownMenu
        label={menuLabel}
        trigger={
          <Button
            type="button"
            variant={variant}
            size={size}
            icon={null}
            disabled={disabled || loading}
            aria-label={menuLabel}
            title={menuLabel}
            // The seam: a hairline in the button's own ink, so it reads on a
            // filled primary and on an outline alike without a palette colour.
            className="rounded-l-none border-l border-l-[color-mix(in_srgb,currentColor_25%,transparent)] px-2"
          >
            <ChevronIcon width={14} height={14} />
          </Button>
        }
      >
        {children}
      </DropdownMenu>
    </div>
  );
}

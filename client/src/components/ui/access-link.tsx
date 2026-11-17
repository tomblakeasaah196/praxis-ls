/**
 * AccessLink: a link that is only offered to someone who can open it.
 *
 * A drop-in for react-router's `<Link>`. It asks `useCanOpenRoute()` about its
 * destination first, and when the reader's role cannot open it, it does not
 * draw the link.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * The ribbon, the rail, the ⌘K palette and the Settings cards have asked
 * before offering a destination for a long time. Links INSIDE screens had not:
 * "Open client" on a sale, "Priced from costing" on a quotation, "Open
 * Appearance" on a settings page. Each was visible to every role and ended, for
 * a role without the target module, on "… is not part of your access". An
 * audit on 17 Nov 2026 counted 67 of them, and the tenant's instruction was to
 * hide what a person cannot use. `npm run check:access` keeps it that way.
 *
 * ── TWO WAYS TO BE DENIED ───────────────────────────────────────────────────
 *
 *   whenDenied="hide"  (default)  Nothing is drawn. Right for an ACTION whose
 *                                 words only make sense as a link: "Open
 *                                 Appearance", "Call settings".
 *   whenDenied="text"             The children are drawn as plain text. Right
 *                                 when the label is DATA the reader still needs
 *                                 to see: a file reference, a client's name, a
 *                                 costing number. Hiding those would remove a
 *                                 fact from the screen, not a door.
 *
 * Outside the app shell (a story, an isolated test) access is unresolved and
 * the link is drawn, the same rule every other filtering surface follows.
 *
 * @example
 * <AccessLink to="/settings/appearance">Open Appearance</AccessLink>
 * <AccessLink to={`/operations/files/${id}`} whenDenied="text">{file.ref}</AccessLink>
 */
import { Link, type LinkProps } from "react-router-dom";
import { useCanOpenRoute } from "@/lib/route-access";

export function AccessLink({
  to,
  whenDenied = "hide",
  children,
  ...rest
}: LinkProps & {
  /** What to draw when the reader cannot open `to`. See the header. */
  whenDenied?: "hide" | "text";
}) {
  const canOpen = useCanOpenRoute();
  const path = typeof to === "string" ? to : to.pathname || "";
  if (!canOpen(path)) {
    return whenDenied === "text" ? <span>{children}</span> : null;
  }
  return (
    <Link to={to} {...rest}>
      {children}
    </Link>
  );
}

/**
 * "May this user open that URL?" — one answer, for every surface that offers a
 * destination.
 *
 * WHY THIS IS A SHARED FUNCTION AND NOT A CHECK PER CALLER. The ribbon and the
 * rail were made permission-aware first, which fixed the two most visible
 * surfaces and left every other one offering the full app: the ⌘K palette lists
 * screens from the static NAV, the Settings hub is a hard-coded card grid, the
 * Control Tower's launcher is twelve hard-coded tiles, and each KPI drill-down
 * ends in a "go to the list" button. A user with no Finance grant was one
 * keystroke from four different routes into it, each of which renders a screen
 * that immediately 403s.
 *
 * Every one of those is the same question, so it is asked in one place. The
 * alternative — a `modules.includes(...)` at each call site — is how the
 * catalogue ends up with five slightly different ideas of what "can see"
 * means.
 *
 * ── WHAT COUNTS AS "CANNOT OPEN" ─────────────────────────────────────────────
 *
 * The join is `screen-registry.json`, the file a new route already has to be
 * added to, and its `module_key` has three states that are NOT the same:
 *
 *   a MOD-xx key   gated. Openable iff the user's visible set contains it.
 *   `null`         deliberately ungated (`/help`). Always openable.
 *   `undefined`    no registry entry at all. ALSO openable — hiding a screen
 *                  because somebody forgot a registry line is a worse failure
 *                  than offering one the API will refuse, and it is the failure
 *                  nobody would ever debug. `ribbon-model.ts` makes the same
 *                  call for the same reason.
 *
 * ── THE HUB LANDING PAGES ARE THE HOLE THIS HAD TO CLOSE ─────────────────────
 *
 * `/finance`, `/wms`, `/fleet` and ten more are routed in `app.tsx` and are
 * NOT in the registry — only their sections are (`/finance/invoices`, …). Read
 * literally, that makes every hub in the product "unregistered", therefore
 * ungated, therefore openable by anyone: the exact routes the ⌘K palette's
 * curated shortcuts and the Control Tower's launcher tiles point at.
 *
 * The fix is not to register them, because a hub is not gated by ONE module.
 * Finance spans MOD-51, MOD-52, MOD-05, MOD-07 and more, and a user with only
 * Journals must still be able to open Finance — the ribbon already shows them
 * that tab. So a hub is gated by its SECTIONS, disjunctively: you can open the
 * container if you can read anything in it. That is what `gatingModulesForPath`
 * returns a LIST for.
 *
 * (Registering the landing pages instead would also have moved the ribbon's
 * taxonomy underneath us — `buildRibbon` votes on an area's family using
 * `moduleForRoute(areaRoute(area))`, so twelve new registry rows would be
 * twelve new votes. This decides access without touching that.)
 *
 * ── AND WHEN THE ANSWER IS NOT IN YET ────────────────────────────────────────
 *
 * `NO_ACCESS` — the empty starting value — is indistinguishable from a user who
 * genuinely has nothing. Filtering against it would empty the palette, the
 * launcher and the Settings grid for a second on every first login. So callers
 * pass the shell's `resolved` flag through `useCanOpenRoute`, and an unresolved
 * shell filters NOTHING. Over-offering for one frame is recoverable; a command
 * palette that opens empty teaches the user it is broken.
 */
import * as React from "react";
import { SCREENS, moduleForRoute } from "@/app/screen-registry";
import { areaForPath, sectionRoute } from "@/app/layout/areas";
import type { GrantAction, NavAccess } from "@/lib/nav-access";
import { useShell } from "@/app/layout/shell-context";

/**
 * Registered routes, longest first, so `/finance/invoices` wins over `/finance`.
 *
 * Built once at module load. The registry is a static import of ~110 rows and
 * this is called for every row of the palette on every keystroke; re-sorting it
 * per call would be the palette's dominant cost.
 */
const BY_LENGTH: { route: string; module: string | null }[] = SCREENS.map(
  (s) => ({
    route: s.route,
    module: s.module_key,
  }),
).sort((a, b) => b.route.length - a.route.length);

/**
 * Which module gates a PATH, as opposed to a registered route.
 *
 * `moduleForRoute` in the registry is an exact lookup, which is right for the
 * ribbon (it only ever asks about routes it built from the registry) and wrong
 * here: the URL bar produces `/finance/invoices/8f2c…`, and an exact lookup
 * calls that unregistered and therefore ungated — turning every detail page in
 * the product into a hole in this check.
 *
 * `undefined` means genuinely unregistered. `/` is matched exactly, because as
 * a prefix it matches the entire application.
 */
export function moduleForPath(pathname: string): string | null | undefined {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/") return BY_LENGTH.find((s) => s.route === "/")?.module;
  const hit = BY_LENGTH.find(
    (s) =>
      s.route !== "/" && (path === s.route || path.startsWith(s.route + "/")),
  );
  return hit ? hit.module : undefined;
}

/**
 * Pages about the signed-in person's OWN account. They sit in the Security & Access hub (so the
 * ribbon and ⌘K find them there) but they are not Security administration: every employee sets
 * their own passkey, Quick PIN and authenticator there, and the account menu offers it to all.
 * Gated by the hub's module, a finance officer or an operations lead was told "Security & Access
 * is not part of your access" on the one page that is theirs. The calls the page makes are the
 * sign-in routes, which need a session and nothing else; the registry keeps its module so the
 * hub's own gating (a hub opens for anyone who can open one of its sections) does not move.
 *
 * `/notifications` is here for the same reason, and it was the more visible case. The page lists
 * the signed-in person's own notifications and their own delivery preferences, and every call it
 * makes (`/notifications`, `/notifications/preferences`, `/:id/read`, `/read-all`) needs a session
 * and nothing else. It is registered under Security & Access because that is where it sits in the
 * ribbon, so "View All" in the bell, which every user has, opened "Security & Access is not part
 * of your access" for anyone who is not an administrator: the first thing a new operations officer
 * with sixty-seven unread notifications is likely to press (tenant report, 17 Nov 2026).
 */
const OWN_ACCOUNT = ["/security/my-security", "/notifications"];

/**
 * Every module that would open this path. EMPTY means "no grant is required" —
 * an ungated route, an unregistered one, or an area with nothing gated in it.
 *
 * More than one entry only happens for a hub landing page, and the caller reads
 * the list disjunctively: any one of them is enough. The first entry doubles as
 * the module the refusal page NAMES, which is why the order follows the area's
 * own section order rather than being a set.
 */
export function gatingModulesForPath(pathname: string): string[] {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (OWN_ACCOUNT.some((p) => path === p || path.startsWith(p + "/"))) return [];
  const direct = moduleForPath(pathname);
  if (direct) return [direct];
  if (direct === null) return []; // registered and deliberately ungated

  const area = areaForPath(pathname);
  if (!area) return [];
  const mods: string[] = [];
  for (const section of area.sections) {
    const mod = moduleForRoute(sectionRoute(area, section));
    // An ungated or unregistered section makes the whole hub reachable — the
    // same lenient rule as everywhere else here, and for the same reason.
    if (mod === null || mod === undefined) return [];
    if (!mods.includes(mod)) mods.push(mod);
  }
  return mods;
}

/** Case-insensitive: `modules` is upper-cased by the server, but a cached record
 *  or a test fixture may not be, and a casing mismatch here would hide half the
 *  app from someone who can see all of it. */
export function canOpenRoute(access: NavAccess, pathname: string): boolean {
  const wanted = gatingModulesForPath(pathname);
  if (wanted.length === 0) return true;
  if (access.isCeo) return true;
  const held = new Set(access.modules.map((k) => String(k).toUpperCase()));
  return wanted.some((m) => held.has(m.toUpperCase()));
}

/**
 * The hook every offering surface uses. Returns a predicate rather than a
 * boolean so a caller can filter a list with it without threading `access`
 * through its own props.
 */
export function useCanOpenRoute(): (pathname: string) => boolean {
  const { access, resolved } = useShell();
  return React.useCallback(
    (pathname: string) => (resolved ? canOpenRoute(access, pathname) : true),
    [access, resolved],
  );
}

/**
 * "Will the server accept this ACTION on this module?"
 *
 * `canOpenRoute` decides whether a screen is offered. This decides whether a
 * BUTTON on it is: New, Edit, Delete, Approve, Post. Until 17 Nov 2026 nothing
 * did. Someone who could read invoices and not create them was shown "New
 * draft", filled the form in, and was refused on Save, and the access audit of
 * that day counted about seventy such buttons. The tenant's instruction was to
 * hide them.
 *
 * WHEN IN DOUBT, OFFER. Three cases answer true without looking:
 *   the CEO          rbac.js lets them through every check
 *   no `actions`     an API or a cached record that predates the field. Absent
 *                    is "unknown", not "nothing" (see NavAccess.actions)
 *   (the hook) an unresolved shell, for the reason `useCanOpenRoute` gives
 * Hiding a button from someone who could have used it is the failure nobody
 * reports. Showing one that is refused is the failure this removes, and the
 * server refuses it either way: this is a courtesy, never the control.
 */
export function canDo(access: NavAccess, moduleKey: string, action: GrantAction): boolean {
  if (access.isCeo) return true;
  if (!access.actions) return true;
  const held = access.actions[moduleKey.toUpperCase()];
  return Array.isArray(held) && held.includes(action);
}

/**
 * The hook a screen uses for its write buttons.
 *
 *     const can = useCan("MOD-51");
 *     action={can("create") && <Button …>{tr("New Draft")}</Button>}
 *
 * The module is the one the ROUTE HANDLER checks (`requirePermission("MOD-51",
 * "create")`), which is usually the screen's own and is worth reading off the
 * route file when it is not. `can("edit", "MOD-10")` asks about a different
 * module for one button without a second hook.
 */
export function useCan(moduleKey: string): (action: GrantAction, otherModule?: string) => boolean {
  const { access, resolved } = useShell();
  return React.useCallback(
    (action: GrantAction, otherModule?: string) =>
      resolved ? canDo(access, otherModule || moduleKey, action) : true,
    [access, resolved, moduleKey],
  );
}

/**
 * "Can this user see module MOD-xx at all?"
 *
 * For an affordance that belongs to a DIFFERENT module than the screen it sits
 * on — the "+ Add carrier" action inside an operations form, which posts to
 * MOD-10 (rate providers). Offering it to someone with no rate-provider grant
 * is a button that always 403s, and a control that only ever fails teaches
 * people not to trust the ones that work.
 *
 * READ VISIBILITY, NOT THE CREATE ACTION. This asks only whether the module is
 * one the user can read, so someone with view-but-not-create still sees the
 * action. When the button is a write, `useCan(moduleKey)("create")` above is
 * the finer question and the one to ask; this one stays for the affordances
 * that only need the module to be there at all.
 *
 * Unresolved shell answers TRUE, for the same reason `useCanOpenRoute` does —
 * over-offering for one frame beats an interface that flickers into existence.
 */
export function useCanUseModule(moduleKey: string): boolean {
  const { access, resolved } = useShell();
  if (!resolved || access.isCeo) return true;
  return access.modules.some(
    (k) => String(k).toUpperCase() === moduleKey.toUpperCase(),
  );
}

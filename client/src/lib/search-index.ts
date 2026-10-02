/**
 * What ⌘K can find without asking the server — every page, hub and 360 tab in
 * `screen-registry.json`, in English and French (tenant review, meeting 6,
 * PR 4 — G5). Records come from `/search` (lib/search-api.ts).
 *
 * The registry is the single list: `scripts/check-search-registry.js` fails
 * the build on a routed screen, a hub section or a `?tab=` tab it does not
 * carry, so "registered" and "findable" are one set.
 *
 * What is NOT offered: the public surfaces (a verification page, the website)
 * and routes that need a record id (`/operations/files/:fileId`) — those are
 * reached through their record, which the record search finds.
 */
import registry from "@/app/screen-registry.json";
import { AREAS } from "@/app/layout/areas";
import { conceptsIn, type Searchable } from "./search-match";

type RegScreen = {
  id: string;
  title: string;
  title_fr?: string;
  route: string;
  area: string;
  module_key: string | null;
  public?: boolean;
  app?: string;
  synonyms?: string[];
};
type RegHub = { id: string; route: string; title: string; title_fr: string; synonyms?: string[] };
type RegTab = {
  id: string;
  source: string;
  value: string;
  title: string;
  title_fr: string;
  record_types: string[];
  synonyms?: string[];
};

export type PageEntry = Searchable & {
  key: string;
  kind: "page" | "hub";
  title: string;
  titleFr: string;
  /** The area heading, in English (translate with navT). */
  area: string;
  to: string;
};

export type TabEntry = Searchable & {
  key: string;
  kind: "tab";
  value: string;
  title: string;
  titleFr: string;
  /** The record types this tab is a tab OF — what "which one?" searches. */
  recordTypes: string[];
};

/**
 * Record types as a person names them — the tab rows ("Clients › Contacts")
 * and the record groups' fallback heading. The server's group labels win when
 * a group arrives; these cover the tabs, which are offered before any record.
 */
export const TYPE_LABEL: Record<string, { en: string; fr: string; one: string; oneFr: string; route: string }> = {
  client: { en: "Clients", fr: "Clients", one: "client", oneFr: "client", route: "/master/clients" },
  supplier: { en: "Suppliers", fr: "Fournisseurs", one: "supplier", oneFr: "fournisseur", route: "/master/suppliers" },
  employee: { en: "Employees", fr: "Employés", one: "employee", oneFr: "employé", route: "/hr/employees" },
  treasury_account: { en: "Treasury accounts", fr: "Comptes de trésorerie", one: "account", oneFr: "compte", route: "/master/treasury-accounts" },
  corporate_entity: { en: "Corporate entities", fr: "Entités", one: "entity", oneFr: "entité", route: "/master/corporate-entities" },
  service_type: { en: "Service types", fr: "Types de service", one: "service type", oneFr: "type de service", route: "/master/service-types" },
  file: { en: "Operations files", fr: "Dossiers", one: "file", oneFr: "dossier", route: "/operations/files" },
  transit_order: { en: "Transit orders", fr: "Ordres de transit", one: "transit order", oneFr: "ordre de transit", route: "/operations/transit-orders" },
  delivery_note: { en: "Delivery notes", fr: "Bons de livraison", one: "delivery note", oneFr: "bon de livraison", route: "/operations/delivery-notes" },
};

const AREA_LABEL = new Map<string, string>(AREAS.map((a) => [a.key, a.label]));
AREA_LABEL.set("home", "Overview");
AREA_LABEL.set("master", "Master data");

const areaOf = (key: string) =>
  AREA_LABEL.get(key) ?? key.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * The texts a candidate answers to — its names first (English, French, then
 * its registry synonyms), its context last — and its synonym groups. Groups
 * come from the NAMES only: "Settings" in an area's name must not make every
 * page in that area a settings page.
 */
function searchable(names: (string | undefined | null)[], context?: string): Searchable {
  const clean = names.filter((t): t is string => !!t && !!t.trim());
  const concepts = new Set<string>();
  for (const n of clean) for (const k of conceptsIn(n)) concepts.add(k);
  return { texts: context ? [...clean, context] : clean, concepts };
}

let pagesCache: PageEntry[] | null = null;
let tabsCache: TabEntry[] | null = null;

/** Every page a person can open by its address alone, and every hub. */
export function pageEntries(): PageEntry[] {
  if (pagesCache) return pagesCache;
  const screens = (registry.screens as RegScreen[]).filter(
    (s) => !s.public && s.app !== "public-web" && !s.route.includes(":") && !s.route.includes("?"),
  );
  const hubs = (registry as unknown as { hubs?: RegHub[] }).hubs ?? [];
  const out: PageEntry[] = [
    ...hubs.map((h) => ({
      key: `hub:${h.id}`,
      kind: "hub" as const,
      title: h.title,
      titleFr: h.title_fr,
      area: h.title,
      to: h.route,
      ...searchable([h.title, h.title_fr, ...(h.synonyms ?? [])]),
    })),
    ...screens.map((s) => ({
      key: `page:${s.id}`,
      kind: "page" as const,
      title: s.title,
      titleFr: s.title_fr || s.title,
      area: areaOf(s.area),
      to: s.route,
      ...searchable([s.title, s.title_fr, ...(s.synonyms ?? [])], areaOf(s.area)),
    })),
  ];
  pagesCache = out;
  return out;
}

/** Every URL-addressable 360 tab, as "the X tab of a <record type>". */
export function tabEntries(): TabEntry[] {
  if (tabsCache) return tabsCache;
  const tabs = (registry as unknown as { tabs?: RegTab[] }).tabs ?? [];
  tabsCache = tabs.map((t) => ({
    key: `tab:${t.id}`,
    kind: "tab" as const,
    value: t.value,
    title: t.title,
    titleFr: t.title_fr,
    recordTypes: t.record_types,
    ...searchable(
      [t.title, t.title_fr, ...(t.synonyms ?? [])],
      t.record_types.map((r) => `${TYPE_LABEL[r]?.en ?? r} ${TYPE_LABEL[r]?.fr ?? ""}`).join(" "),
    ),
  }));
  return tabsCache;
}

/** A record's URL with the tab added — `?focus=x` or `/x`, either way. */
export function withTab(url: string, value: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}tab=${encodeURIComponent(value)}`;
}

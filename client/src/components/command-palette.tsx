/**
 * ⌘K — search that finds everything (tenant review, meeting 6, PR 4 — G5).
 *
 * WHAT IT FINDS, in the order it shows them:
 *
 *   Pages    every screen and hub in `screen-registry.json`, by its English or
 *            French title, its registry synonyms, and the shared synonym list
 *            ("devis", "cotation" and "offer" all find Quotations). Folded —
 *            case and accents ignored — and a one-letter typo still finds it.
 *   Tabs     every URL-addressable tab of every 360 ("Contacts" → the Contacts
 *            tab of a client). A tab belongs to a record, so choosing one asks
 *            WHICH record, and opens it on that tab.
 *   Records  clients, files, quotations, invoices, employees… by number or by
 *            name, from `/search` (lib/search-api.ts), one group per type.
 *   Actions  the quick commands, and "Ask Praxis AI" — with what was typed.
 *
 * Empty, it shows recent searches, a few places to jump to, and the actions.
 *
 * IT OFFERS ONLY WHAT THIS PERSON CAN OPEN — never a door that 403s. Pages
 * and tabs go through `canOpenRoute`, the shell's own predicate. Records are
 * filtered by the SERVER on each module's `view` grant before any query runs,
 * and then by `canOpenRoute` here on the address they open — the second lock
 * on the same door. `useCanOpenRoute` filters nothing while the permissions
 * read is unresolved, so the palette is never briefly empty
 * (command-palette.test.tsx pins both halves).
 *
 * Keyboard first: ↑ ↓ to move, Enter to open, Esc to step back out of a
 * "which record?" question or to close. Arrow keys never leave the input.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { tr, tv, navT } from "@/lib/i18n";
import { useCanOpenRoute } from "@/lib/route-access";
import { money, dateFmt, enumLabel } from "@/lib/format";
import { conceptsTyped, score, fold } from "@/lib/search-match";
import { pageEntries, tabEntries, TYPE_LABEL, withTab, type PageEntry, type TabEntry } from "@/lib/search-index";
import { searchRecords, searchable, type RecordGroup, type RecordHit } from "@/lib/search-api";

type PaletteGroup = { heading: string; items: { to: string; label: string }[] };
type IP = React.SVGProps<SVGSVGElement>;
type Row = {
  key: string;
  label: string;
  /** Monospaced reference beside the label (a number). */
  ref?: string | null;
  sub?: string;
  Icon: (p: IP) => React.JSX.Element;
  run: () => void;
};
type Section = { key: string; heading: string; rows: Row[] };

const sic = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 17,
  height: 17,
  "aria-hidden": true,
  ...p,
});
const SearchIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const TowerIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="m6 9 6-6 6 6M6 9v11h12V9" />
  </svg>
);
const FolderIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 5h6l2 3h8v11H4z" />
  </svg>
);
const CardIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18" />
  </svg>
);
const FleetIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 7h13l5 5v4h-3" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);
const BoxIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 9l9-5 9 5v8l-9 5-9-5z" />
  </svg>
);
const PlusIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const FileTextIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4M9 13h6M9 17h6" />
  </svg>
);
const TaxIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 16v-4M12 16V9M16 16v-6" />
  </svg>
);
const AiIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);
const ChatIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" />
  </svg>
);
const TabIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 8h7l2-3h9v14H3z" />
  </svg>
);
const RecordIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);
const ClockIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);

// Curated "Jump to" shortcuts shown when the query is empty.
const JUMP: { to: string; label: string; Icon: (p: IP) => React.JSX.Element }[] = [
  { to: "/", label: "Control Tower", Icon: TowerIcon },
  { to: "/operations", label: "Operations", Icon: FolderIcon },
  { to: "/finance", label: "Finance & Treasury", Icon: CardIcon },
  { to: "/fleet", label: "Fleet", Icon: FleetIcon },
  { to: "/wms", label: "Warehouse", Icon: BoxIcon },
];

/** Record groups in the order a desk reads them: who, what moves, what it costs. */
const TYPE_ORDER = [
  "client", "contact", "supplier", "supplier_contact", "lead", "quote_request", "opportunity", "proposal",
  "quotation", "file", "transit_order", "delivery_note", "costing", "cash_request", "invoice", "proforma",
  "credit_note", "receipt", "purchase_order", "supplier_invoice", "employee", "treasury_account",
  "dictionary_item", "service_type", "corporate_entity", "document", "vehicle",
];
const typeRank = (t: string) => {
  const i = TYPE_ORDER.indexOf(t);
  return i < 0 ? TYPE_ORDER.length : i;
};

/* ── recent searches: a per-person convenience, so the browser's storage ─── */

const RECENT_KEY = "praxis.palette.recent";
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    /* @silent:storage — no storage (private window, blocked site data): no recents, nothing else changes */
    return [];
  }
}
function rememberSearch(q: string) {
  const term = q.trim();
  if (term.length < 2) return;
  try {
    const next = [term, ...readRecent().filter((x) => fold(x) !== fold(term))].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* @silent:storage — a search that cannot be remembered still ran */
  }
}

/* ── the server's half: debounced, cancelled when the term moves on ───────── */

function useRecordSearch(q: string, types: string[] | null, enabled: boolean) {
  const [state, setState] = React.useState<{ q: string; groups: RecordGroup[]; loading: boolean; failed: boolean }>({
    q: "",
    groups: [],
    loading: false,
    failed: false,
  });
  const typesKey = types ? types.join(",") : "";
  React.useEffect(() => {
    const term = q.trim();
    if (!enabled || !searchable(term)) {
      setState({ q: term, groups: [], loading: false, failed: false });
      return;
    }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, failed: false }));
    const id = window.setTimeout(() => {
      searchRecords(term, { types: typesKey ? typesKey.split(",") : undefined, limit: typesKey ? 10 : 5, signal: ctl.signal })
        .then((answer) => {
          if (!ctl.signal.aborted) setState({ q: term, groups: answer.groups || [], loading: false, failed: false });
        })
        .catch(() => {
          // Not silent: the palette says records could not be searched, and
          // pages, tabs and actions still answer.
          if (!ctl.signal.aborted) setState({ q: term, groups: [], loading: false, failed: true });
        });
    }, 180);
    return () => {
      ctl.abort();
      window.clearTimeout(id);
    };
  }, [q, typesKey, enabled]);
  return state;
}

export function CommandPalette({ open, groups, onClose }: { open: boolean; groups: PaletteGroup[]; onClose: () => void }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const fr = (i18n.language || "").startsWith("fr");
  const canOpen = useCanOpenRoute();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  /** "Which client?" — a tab was chosen, and now a record of its type is. */
  const [pendingTab, setPendingTab] = React.useState<TabEntry | null>(null);
  const [recent, setRecent] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const q = query.trim();

  const go = React.useCallback(
    (to: string) => {
      rememberSearch(query);
      onClose();
      navigate(to);
    },
    [navigate, onClose, query],
  );
  const askAi = React.useCallback(
    (prompt?: string) => {
      onClose();
      window.dispatchEvent(new CustomEvent("praxis:open-copilot", prompt ? { detail: { prompt } } : undefined));
    },
    [onClose],
  );

  const records = useRecordSearch(q, pendingTab ? pendingTab.recordTypes : null, open);

  // `to` is carried on the action rather than buried in the closure so the
  // filter below can see where each one goes. "Ask Praxis AI…" has no route:
  // it opens a panel, is gated by the tenant's AI flag rather than by a
  // module, and must not be filtered out by a route check it does not take.
  const actions: Row[] = React.useMemo(() => {
    const base = [
      { key: "act:new-dossier", label: tr("New operations file"), Icon: PlusIcon, to: "/operations" },
      { key: "act:new-invoice", label: tr("New invoice"), Icon: FileTextIcon, to: "/finance" },
      { key: "act:file-tax", label: tr("File a tax return"), Icon: TaxIcon, to: "/finance/tax" },
      { key: "act:messages", label: tr("Open Messages"), Icon: ChatIcon, to: "/comms" },
    ]
      .filter((a) => canOpen(a.to))
      .map((a) => ({ key: a.key, label: a.label, Icon: a.Icon, run: () => go(a.to) }));
    const filtered = q ? base.filter((a) => fold(a.label).includes(fold(q))) : base;
    return [
      ...filtered,
      q
        ? { key: "act:ask-ai", label: tv("Ask Praxis AI about “{{q}}”", { q }), Icon: AiIcon, run: () => askAi(q) }
        : { key: "act:ask-ai", label: tr("Ask Praxis AI…"), Icon: AiIcon, run: () => askAi() },
    ];
  }, [canOpen, go, askAi, q]);

  const sections: Section[] = React.useMemo(() => {
    // ── "which record?" for a chosen tab ──────────────────────────────────
    if (pendingTab) {
      const rows: Row[] = records.groups
        .filter((g) => pendingTab.recordTypes.includes(g.type))
        .flatMap((g) => g.items)
        .filter((r) => canOpen(r.url))
        .map((r) => recordRow(r, () => go(withTab(r.url, pendingTab.value)), fr));
      return rows.length ? [{ key: "pick", heading: tr("Open on this tab"), rows }] : [];
    }

    // ── empty: recent, jump to, actions ───────────────────────────────────
    if (!q) {
      const out: Section[] = [];
      if (recent.length) {
        out.push({
          key: "recent",
          heading: tr("Recent searches"),
          rows: recent.map((r) => ({ key: `recent:${r}`, label: r, Icon: ClockIcon, run: () => setQuery(r) })),
        });
      }
      out.push({
        key: "jump",
        heading: tr("Jump to"),
        rows: JUMP.filter((j) => canOpen(j.to)).map((j) => ({
          key: `jump:${j.to}`,
          label: navT(t, j.label),
          Icon: j.Icon,
          run: () => go(j.to),
        })),
      });
      out.push({ key: "actions", heading: tr("Actions"), rows: actions });
      return out.filter((s) => s.rows.length);
    }

    const typed = conceptsTyped(q);
    const out: Section[] = [];

    // ── Pages: the registry, then the shell's own nav for anything only it has
    const pages = pageEntries()
      .filter((p) => canOpen(p.to))
      .map((p) => ({ p, s: score(q, p, typed) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.p.kind === "hub") - Number(a.p.kind === "hub") || a.p.title.localeCompare(b.p.title));
    const seen = new Set(pages.map((x) => x.p.to));
    const navOnly = groups
      .flatMap((g) => g.items.map((it) => ({ ...it, group: g.heading })))
      .filter((it) => !seen.has(it.to) && canOpen(it.to))
      .filter((it) => fold(`${it.label} ${it.group}`).includes(fold(q)));
    const pageRows: Row[] = [
      ...pages.slice(0, 8).map(({ p }) => pageRow(p, () => go(p.to), fr, t)),
      ...navOnly.slice(0, 3).map((it) => ({ key: `nav:${it.to}`, label: it.label, sub: it.group, Icon: FolderIcon, run: () => go(it.to) })),
    ];
    if (pageRows.length) out.push({ key: "pages", heading: tr("Pages"), rows: pageRows });

    // ── Tabs: only where a record of the tab's type can be opened at all
    const tabs = tabEntries()
      .filter((tb) => tb.recordTypes.some((r) => !TYPE_LABEL[r] || canOpen(TYPE_LABEL[r].route)))
      .map((tb) => ({ tb, s: score(q, tb, typed) }))
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map(({ tb }) => tb);
    const tabRows: Row[] = tabs.map((tb) => {
      const host = tb.recordTypes.map((r) => (fr ? TYPE_LABEL[r]?.fr : TYPE_LABEL[r]?.en) ?? r).join(" / ");
      return {
        key: tb.key,
        label: `${host} › ${fr ? tb.titleFr : tb.title}`,
        sub: tr("Tab"),
        Icon: TabIcon,
        run: () => {
          setPendingTab(tb);
          setQuery("");
          requestAnimationFrame(() => inputRef.current?.focus());
        },
      };
    });
    if (tabRows.length) out.push({ key: "tabs", heading: tr("Tabs"), rows: tabRows });

    // ── Records, one group per type
    if (records.q === q) {
      for (const g of [...records.groups].sort((a, b) => typeRank(a.type) - typeRank(b.type))) {
        const rows = g.items.filter((r) => canOpen(r.url)).map((r) => recordRow(r, () => go(r.url), fr));
        if (rows.length) out.push({ key: `rec:${g.type}`, heading: fr ? g.label.fr : g.label.en, rows });
      }
    }

    out.push({ key: "actions", heading: tr("Actions"), rows: actions });
    return out;
  }, [pendingTab, records, q, recent, actions, groups, canOpen, go, fr, t]);

  const rows = React.useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setPendingTab(null);
    setRecent(readRecent());
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  React.useEffect(() => setActive(0), [query, pendingTab]);
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (pendingTab) {
        setPendingTab(null);
        return;
      }
      onClose();
    } else if (e.key === "Backspace" && pendingTab && !query) {
      setPendingTab(null);
    }
  }

  let idx = -1;
  const pendingHost = pendingTab
    ? pendingTab.recordTypes.map((r) => (fr ? TYPE_LABEL[r]?.oneFr : TYPE_LABEL[r]?.one) ?? r).join(" / ")
    : "";
  const searching = records.loading && !!q;
  // Pages, tabs and records — "Ask Praxis AI" is always there, so it does not count.
  const empty = !!q && !sections.some((s) => s.key !== "actions");

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      {/* Decorative scrim. Click-to-dismiss is a pointer convenience whose
          keyboard equivalent is Escape, handled in onKeyDown below. */}
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-black/40" onClick={onClose} />
      {/* A dialog handling its own arrow/Enter/Escape keys is the WAI-ARIA
          pattern, not a violation — the rule cannot tell a composite widget from
          a decorated <p>, and flags any key handler on a non-<button> role. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr("Command palette")}
        className="lux-card shadow-l relative z-10 w-full max-w-xl overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b px-4">
          <span className="text-muted-foreground">
            <SearchIcon />
          </span>
          {pendingTab ? (
            <span className="inline-flex max-w-[45%] shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-foreground">
              <span className="truncate">{fr ? pendingTab.titleFr : pendingTab.title}</span>
              <button
                type="button"
                className="rounded-full px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={tr("Back to all results")}
                onClick={() => setPendingTab(null)}
              >
                ×
              </button>
            </span>
          ) : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={tr("Search pages, tabs, records and actions")}
            placeholder={
              pendingTab
                ? tv("Which {{record}}? Type a name or number…", { record: pendingHost })
                : tr("Search pages, clients, files, quotations, invoices…")
            }
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {searching ? (
            <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground" role="status">
              {tr("Searching records…")}
            </p>
          ) : null}
          {records.failed && q ? (
            <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground" role="status">
              {tr("Records could not be searched just now — pages and actions still answer.")}
            </p>
          ) : null}
          {pendingTab && !rows.length && !searching ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {q ? tv("No {{record}} matches “{{q}}”.", { record: pendingHost, q: query }) : tv("Type to find the {{record}} to open.", { record: pendingHost })}
            </p>
          ) : null}
          {!pendingTab && empty && !searching ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{tv("Nothing matches “{{q}}”.", { q: query })}</p>
          ) : null}
          {sections.map((s) => (
            <div key={s.key} role="group" aria-label={s.heading}>
              <p className="micro px-3 pb-1 pt-3">{s.heading}</p>
              {s.rows.map((r) => {
                idx += 1;
                const i = idx;
                return (
                  <button
                    key={r.key}
                    type="button"
                    data-idx={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={r.run}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                      i === active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <span className="text-primary-ink">
                      <r.Icon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {r.label}
                        {r.ref && r.ref !== r.label ? <span className="num ml-2 text-xs font-normal text-muted-foreground">{r.ref}</span> : null}
                      </span>
                      {r.sub ? <span className="block truncate text-xs text-muted-foreground">{r.sub}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function pageRow(p: PageEntry, run: () => void, fr: boolean, t: (k: string, o?: { defaultValue?: string }) => string): Row {
  return {
    key: p.key,
    label: fr ? p.titleFr : p.title,
    sub: p.kind === "hub" ? tr("Area") : navT(t, p.area),
    Icon: FolderIcon,
    run,
  };
}

/** "QUO-2026-0007 — Acme · Sent · 1 100 000 XAF · 27/07/2026" */
function recordRow(r: RecordHit, run: () => void, fr: boolean): Row {
  const parts = [
    r.sub,
    r.status ? enumLabel(r.status) : null,
    r.amount !== null ? money(r.amount, r.currency || "XAF") : null,
    r.date ? dateFmt(r.date) : null,
  ].filter(Boolean);
  return {
    key: `rec:${r.type}:${r.id}`,
    label: (fr ? r.title_fr || r.title : r.title) || r.ref || tr("Untitled"),
    ref: r.ref,
    sub: parts.join(" · ") || undefined,
    Icon: RecordIcon,
    run,
  };
}

export default CommandPalette;

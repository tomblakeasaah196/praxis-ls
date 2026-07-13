/**
 * Protected app shell — Lovable "Control Tower" look on the app's real nav.
 *
 * Navigation now lives in the top command bar (per the Lovable mock): the
 * primary areas — Control Tower, Finance, Warehouse, Fleet — sit inline. Areas
 * with child screens open a dropdown of those screens; Control Tower is a direct
 * link. A "More" button opens the full menu (every group) as a collapsible
 * overlay sidebar that closes on outside-click or Escape. On mobile the inline
 * areas collapse and the hamburger opens that same sidebar.
 */
import * as React from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { tokenStore } from "@/lib/token-store";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

type NavItem = { to: string; label: string };
type NavGroup = { heading: string; items: NavItem[]; prefix?: string };

const NAV: NavGroup[] = [
  { heading: "Overview", prefix: "/", items: [{ to: "/", label: "Control Tower" }] },
  {
    heading: "Finance",
    prefix: "/finance",
    items: [
      { to: "/finance/chart-of-accounts", label: "Chart of accounts" },
      { to: "/finance/journals", label: "Journals" },
      { to: "/finance/proformas", label: "Proforma & advances" },
      { to: "/finance/invoices", label: "Invoices" },
      { to: "/finance/receivables", label: "Receivables" },
      { to: "/finance/statements", label: "Statements" },
      { to: "/finance/tax", label: "Tax center" },
      { to: "/finance/assets", label: "Assets" },
    ],
  },
  {
    heading: "Security & Access",
    prefix: "/security",
    items: [
      { to: "/security/users", label: "Users" },
      { to: "/security/roles", label: "Roles" },
      { to: "/security/permissions", label: "Permission matrix" },
      { to: "/security/capabilities", label: "Capabilities" },
      { to: "/security/scopes", label: "Scopes" },
      { to: "/security/field-visibility", label: "Field visibility" },
      { to: "/security/sessions", label: "My sessions" },
    ],
  },
  {
    heading: "Fleet",
    prefix: "/fleet",
    items: [
      { to: "/fleet/vehicles", label: "Vehicles" },
      { to: "/fleet/compliance", label: "Compliance" },
      { to: "/fleet/work-orders", label: "Work orders" },
      { to: "/fleet/dispatch", label: "Dispatch" },
      { to: "/fleet/fuel", label: "Fuel log" },
      { to: "/fleet/drivers", label: "Drivers" },
      { to: "/fleet/incidents", label: "Incidents" },
    ],
  },
  {
    heading: "Warehouse",
    prefix: "/wms",
    items: [
      { to: "/wms/locations", label: "Locations" },
      { to: "/wms/inventory", label: "Inventory" },
      { to: "/wms/inbound", label: "Inbound / GRN" },
      { to: "/wms/outbound", label: "Outbound" },
      { to: "/wms/equipment", label: "Equipment" },
      { to: "/wms/cycle-counts", label: "Cycle counts" },
    ],
  },
  {
    heading: "People & HR",
    prefix: "/hr",
    items: [
      { to: "/hr/employees", label: "Employees" },
      { to: "/hr/payroll", label: "Payroll" },
      { to: "/hr/vacancies", label: "Vacancies" },
      { to: "/hr/contracts", label: "Contracts" },
      { to: "/hr/appraisals", label: "Appraisals" },
      { to: "/hr/attendance", label: "Attendance" },
      { to: "/hr/leave", label: "Leave & allowances" },
      { to: "/hr/sops", label: "SOPs" },
      { to: "/hr/trainings", label: "Trainings" },
      { to: "/hr/talent-pool", label: "Talent pool" },
    ],
  },
  {
    heading: "Governance",
    items: [
      { to: "/audit", label: "Audit ledger" },
      { to: "/notifications", label: "Notifications" },
      { to: "/workflows", label: "Workflows" },
      { to: "/approvals", label: "Approvals" },
      { to: "/appearance", label: "Appearance" },
      { to: "/settings", label: "Settings" },
    ],
  },
];

/** Areas surfaced inline in the top bar (in order). The rest live under More. */
const TOPBAR = ["Overview", "Finance", "Warehouse", "Fleet"];

// --- tiny inline icons (stroke inherits currentColor) ----------------------
type IP = React.SVGProps<SVGSVGElement>;
const sic = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 16,
  height: 16,
  "aria-hidden": true,
  ...p,
});
const TowerIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 11l9-8 9 8M5 10v10h14V10" />
  </svg>
);
const FinanceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
  </svg>
);
const WarehouseIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 9l9-5 9 5v10l-9 5-9-5z" />
  </svg>
);
const FleetIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 7h13l5 5v5h-3" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);
const MoreIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);
const ChevronIcon = (p: IP) => (
  <svg {...sic(p)} width={14} height={14}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const AREA_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  Overview: TowerIcon,
  Finance: FinanceIcon,
  Warehouse: WarehouseIcon,
  Fleet: FleetIcon,
};

/** A top-bar area: a direct link (single item) or a dropdown of its screens. */
function NavArea({
  group,
  active,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const Icon = AREA_ICON[group.heading] || MoreIcon;
  const label = group.heading === "Overview" ? "Control Tower" : group.heading;

  // Single-item area (Overview) → direct link, no dropdown.
  if (group.items.length === 1) {
    return (
      <NavLink to={group.items[0].to} end className={cn("lux-navlink", active && "active")} onClick={onNavigate}>
        <Icon />
        <span>{label}</span>
      </NavLink>
    );
  }

  return (
    <div className="relative" data-navarea>
      <button
        className={cn("lux-navlink", (active || open) && "active")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon />
        <span>{label}</span>
        <ChevronIcon className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-50 min-w-56 animate-fade-in rounded-xl border bg-popover p-2 shadow-l"
        >
          {group.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              role="menuitem"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/** The full grouped menu — rendered inside the More overlay sidebar. */
function SidebarLinks({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav className="flex flex-col gap-5 p-3">
      {NAV.map((g) => (
        <div key={g.heading}>
          <p className="micro px-3 pb-2">{g.heading === "Overview" ? "Overview" : g.heading}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                onClick={onNavigate}
                style={({ isActive }) => (isActive ? { borderLeftColor: "rgb(var(--brand-orange))" } : undefined)}
                className={({ isActive }) =>
                  cn(
                    "rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )
                }
              >
                {it.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-9 w-auto" />
      ) : (
        <span className="lux-mark">{name.charAt(0)}</span>
      )}
      <div className="leading-tight">
        <div className="font-display text-[17px] tracking-tight">{name}</div>
        <div className="micro mt-0.5">Control Tower</div>
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [openArea, setOpenArea] = React.useState<string | null>(null);
  const env = tokenStore.getEnv();

  // Close dropdowns on outside-click and Escape; close everything on navigation.
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest("[data-navarea]")) setOpenArea(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenArea(null);
        setSidebarOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  React.useEffect(() => {
    setOpenArea(null);
    setSidebarOpen(false);
  }, [location.pathname]);

  function isAreaActive(g: NavGroup): boolean {
    if (g.heading === "Overview") return location.pathname === "/";
    return !!g.prefix && location.pathname.startsWith(g.prefix);
  }

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  // Test/Live switch — persists X-Praxis-Env then reloads so every screen
  // re-fetches under the new environment (separate live/sandbox schemas).
  function toggleEnv() {
    const next = env === "sandbox" ? "live" : "sandbox";
    tokenStore.setEnv(next);
    window.location.reload();
  }

  const topbarGroups = TOPBAR.map((h) => NAV.find((g) => g.heading === h)!).filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      {/* Top command bar */}
      <header className="lux-topbar flex h-[66px] flex-none items-center gap-3 px-4 md:px-6">
        <button
          className="md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
        <Brand name={brandName} logoUrl={branding.logoUrl} />

        {/* Inline primary nav (desktop) */}
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {topbarGroups.map((g) => (
            <NavArea
              key={g.heading}
              group={g}
              active={isAreaActive(g)}
              open={openArea === g.heading}
              onToggle={() => setOpenArea((cur) => (cur === g.heading ? null : g.heading))}
              onNavigate={() => setOpenArea(null)}
            />
          ))}
          <button className="lux-navlink" aria-haspopup="dialog" onClick={() => setSidebarOpen(true)}>
            <MoreIcon />
            <span>More</span>
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="hidden items-center gap-2 rounded-xl border bg-accent/40 px-3 py-2 text-muted-foreground lg:flex"
            title="Browse all screens"
          >
            <span className="text-xs">Search dossiers, invoices, people…</span>
            <span className="ml-6 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold">⌘K</span>
          </button>
          <button
            onClick={toggleEnv}
            title={env === "sandbox" ? "Switch to LIVE" : "Switch to TEST MODE"}
            className={cn("status", env === "sandbox" ? "st-warn" : "st-ok")}
          >
            {env === "sandbox" ? "TEST MODE" : "LIVE"}
          </button>
          <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </header>

      {/* Collapsible overlay sidebar (More / mobile hamburger) — full menu */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="lux-sidebar-in absolute left-0 top-0 flex h-full w-72 flex-col overflow-y-auto border-r bg-sidebar">
            <div className="flex h-[66px] flex-none items-center justify-between border-b px-4">
              <Brand name={brandName} logoUrl={branding.logoUrl} />
              <button onClick={() => setSidebarOpen(false)} aria-label="Close menu">
                ✕
              </button>
            </div>
            <SidebarLinks onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Floating action cluster (Pixie "Hub" floatbar) — a primary FAB, bottom-right,
 * that expands into round quick-action buttons: Praxis AI (opens the copilot),
 * Messages (Smart Comms), and Help. The primary button carries an unread badge.
 * The AI action only appears when the tenant's AI is enabled.
 *
 * Praxis AI opens the copilot via the `praxis:open-copilot` window event, so this
 * stays decoupled from the copilot component (which owns the panel).
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAiEnabled } from "@/components/ai-actions";
import { cn } from "@/lib/cn";

type IP = React.SVGProps<SVGSVGElement>;
const s = (p: IP) => ({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 20, height: 20, "aria-hidden": true, ...p });
const AiIcon = (p: IP) => (<svg {...s(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>);
const ChatIcon = (p: IP) => (<svg {...s(p)}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" /></svg>);
const HelpIcon = (p: IP) => (<svg {...s(p)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 013.5-1.8c1 .5 1.5 1.6 1 2.6-.4.9-1.5 1.2-2 2-.2.4-.2.8-.2 1.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>);
const BurstIcon = (p: IP) => (<svg {...s(p)} width={24} height={24}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /><circle cx="12" cy="12" r="2.5" /></svg>);

export function FloatingActions({ badge = 0 }: { badge?: number }) {
  const aiEnabled = useAiEnabled();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open on hover (with a short grace delay so moving between buttons doesn't
  // snap it shut); click still toggles for touch/keyboard.
  const openNow = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const closeSoon = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 220); };

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const actions = [
    aiEnabled && {
      key: "ai",
      label: "Praxis AI",
      Icon: AiIcon,
      onClick: () => { window.dispatchEvent(new CustomEvent("praxis:open-copilot")); setOpen(false); },
    },
    { key: "msg", label: "Messages", Icon: ChatIcon, onClick: () => { navigate("/comms"); setOpen(false); } },
    { key: "help", label: "Help", Icon: HelpIcon, onClick: () => { navigate("/help"); setOpen(false); } },
  ].filter(Boolean) as { key: string; label: string; Icon: (p: IP) => React.JSX.Element; onClick: () => void }[];

  return (
    <div ref={ref} onMouseEnter={openNow} onMouseLeave={closeSoon} className="fixed bottom-24 right-5 z-50 flex flex-col items-end gap-3 md:bottom-6">
      {open &&
        actions.map((a, i) => (
          <div key={a.key} className="flex items-center gap-2 animate-fade-in" style={{ animationDelay: `${i * 30}ms` }}>
            <span className="rounded-md border bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-md">{a.label}</span>
            <button
              onClick={a.onClick}
              title={a.label}
              aria-label={a.label}
              className="grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground shadow-lg transition-transform hover:scale-105 hover:text-[rgb(var(--primary))]"
            >
              <a.Icon />
            </button>
          </div>
        ))}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Quick actions"
        aria-expanded={open}
        className={cn(
          "relative grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105",
          open && "rotate-45",
        )}
      >
        <BurstIcon />
        {badge > 0 && !open && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </div>
  );
}

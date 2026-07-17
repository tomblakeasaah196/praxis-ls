/**
 * TabbedHub — the shared hub shell (Master Data pattern, generalised). Renders an
 * eyebrow + segmented accent tabs + the active tab's page, with a keyed fade on
 * switch. Deep-linkable via `<basePath>` and `<basePath>/:section`; nav collapses
 * to one entry. Each tab renders its existing page component unchanged, so
 * per-module RBAC/org-workflow are untouched.
 */
import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";

export type HubTab = { key: string; label: string; Component: React.ComponentType };

export function TabbedHub({ eyebrow, basePath, tabs }: { eyebrow: string; basePath: string; tabs: HubTab[] }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = tabs.find((t) => t.key === section) || tabs[0];
  const Active = active.Component;

  return (
    <div className="animate-fade-in">
      <div className="mx-auto mb-4 max-w-6xl">
        <div className="micro mb-2">{eyebrow}</div>
        <div className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => navigate(`${basePath}/${t.key}`)}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                active.key === t.key
                  ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div key={active.key} className="animate-fade-in">
        <Active />
      </div>
    </div>
  );
}

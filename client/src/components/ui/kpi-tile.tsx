/** Compact KPI tile + row — the glass summary strip at the top of a list screen.
 *  A tenant-tinted accent bar + hover lift keep it from feeling flat. Values use
 *  the `.num` tabular class and a Playfair display size. Fully token-driven. */
import * as React from "react";

export function KpiTile({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="lux-card relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-m)]">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary to-transparent" />
      <div className="flex items-start justify-between gap-2">
        <div className="micro">{label}</div>
        {icon && <span className="text-primary">{icon}</span>}
      </div>
      <div className="num mt-1.5 font-display text-[26px] leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

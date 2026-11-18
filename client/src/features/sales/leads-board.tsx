/**
 * The Leads board (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, owner decision D3).
 *
 * It shows REQUESTS, not companies: one company can have a deal at Quoted and
 * another at New, and a column of companies could not say which. Four working
 * columns, New, Contacted, Meeting and Quoted; Won and Lost folded shut at the
 * end, because a closed deal is history and should not take a quarter of the
 * screen. Dragging a card moves its stage through the same `/stage` route the
 * request sheet's bar uses. Dropping on Lost asks why first. Won is never a
 * drop: a win opens the operations file, so it is the request sheet's Mark Won.
 *
 * Desktop only (§3.9). On a phone the list is the only view.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { errMsg, useResource } from "@/lib/use-resource";
import { money, cell } from "@/lib/format";
import { useCan } from "@/lib/route-access";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { serviceNameOf } from "@/lib/quote-request-api";
import { OPEN_STAGES, boardColumn, moveStage, stageLabel } from "@/lib/lead-api";
import { LostDialog } from "./request-sheet";

type Card = Record<string, unknown> & { quote_request_id: string; lead_id?: string | null; stage: string };
type Columns = Record<string, { rows: Card[]; total: number }>;

const ALL = [...OPEN_STAGES, "WON", "LOST"] as string[];

async function loadBoard(q: string): Promise<Columns> {
  const out = await Promise.all(ALL.map((s) => boardColumn(s, q)));
  return Object.fromEntries(ALL.map((s, i) => [s, { rows: out[i].rows as Card[], total: out[i].total }]));
}

function CardBody({ c, moneyVisible }: { c: Card; moneyVisible: boolean }) {
  const service = serviceNameOf({ name_en: c.service_name_en as string, name_fr: c.service_name_fr as string }) || cell(c.service_category);
  const value = c.estimated_value != null && c.estimated_value !== "" && moneyVisible ? money(c.estimated_value, c.currency || "XAF") : null;
  return (
    <>
      <span className="block truncate text-sm font-semibold text-foreground">{cell(c.lead_company_name || c.requester_company)}</span>
      <span className="block truncate text-xs text-muted-foreground">{[c.public_ref, c.title || service].filter(Boolean).join(" · ")}</span>
      {value ? <span className="num block text-xs font-medium text-foreground">{value}</span> : null}
    </>
  );
}

function BoardCard({ c, onOpen, moneyVisible, draggable }: { c: Card; onOpen: () => void; moneyVisible: boolean; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: c.quote_request_id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <li ref={setNodeRef} style={style} className={cn("rounded-lg border bg-card", isDragging && "relative z-10 shadow-[var(--shadow-l)]")}>
      <button type="button" className="w-full p-2 text-left" onClick={onOpen} {...attributes} {...listeners}>
        <CardBody c={c} moneyVisible={moneyVisible} />
      </button>
    </li>
  );
}

function Column({
  stage,
  data,
  collapsed,
  onToggle,
  children,
}: {
  stage: string;
  data: { rows: Card[]; total: number } | undefined;
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: stage === "WON" });
  return (
    <section
      ref={setNodeRef}
      aria-label={stageLabel(stage)}
      className={cn("flex min-w-0 flex-col gap-2 rounded-lg border p-2", isOver && "border-primary", collapsed ? "w-40 shrink-0" : "flex-1")}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-foreground">{stageLabel(stage)}</h2>
        {onToggle ? (
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={!collapsed}>
            <span className="num">{data?.total ?? 0}</span>
          </Button>
        ) : (
          <span className="num micro">{data?.total ?? 0}</span>
        )}
      </header>
      {collapsed ? null : children}
    </section>
  );
}

export function LeadsBoard({ q, moneyVisible }: { q: string; moneyVisible: boolean }) {
  const res = useResource(() => loadBoard(q), [q], { fresh: true });
  const navigate = useNavigate();
  const toast = useToast();
  const can = useCan("MOD-20");
  const [openSettled, setOpenSettled] = React.useState<Record<string, boolean>>({});
  const [losing, setLosing] = React.useState<Card | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));

  const open = (c: Card) => {
    if (c.lead_id) navigate(`/sales/leads/${String(c.lead_id)}?request=${encodeURIComponent(c.quote_request_id)}`);
  };

  const find = (id: string) => ALL.flatMap((s) => res.data?.[s]?.rows || []).find((c) => c.quote_request_id === id) || null;

  async function onDragEnd(e: DragEndEvent) {
    const to = e.over?.id ? String(e.over.id) : null;
    const card = find(String(e.active.id));
    if (!card || !to || to === card.stage || to === "WON") return;
    if (card.stage === "WON" || card.stage === "LOST") return;
    if (to === "LOST") {
      setLosing(card);
      return;
    }
    try {
      await moveStage(card.quote_request_id, { stage: to });
      res.reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  if (res.error) return <ErrorState message={res.error} />;
  if (!res.data) return <LoadingRow label={tr("Loading…")} />;

  const list = (s: string) => (
    <ul className="flex flex-col gap-2">
      {(res.data?.[s]?.rows || []).map((c) => (
        <BoardCard key={c.quote_request_id} c={c} moneyVisible={moneyVisible} onOpen={() => open(c)} draggable={can("edit") && s !== "WON" && s !== "LOST"} />
      ))}
    </ul>
  );

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {OPEN_STAGES.map((s) => (
          <Column key={s} stage={s} data={res.data?.[s]}>
            {list(s)}
          </Column>
        ))}
        {(["WON", "LOST"] as const).map((s) => (
          <Column
            key={s}
            stage={s}
            data={res.data?.[s]}
            collapsed={!openSettled[s]}
            onToggle={() => setOpenSettled((o) => ({ ...o, [s]: !o[s] }))}
          >
            {list(s)}
          </Column>
        ))}
      </div>
      <LostDialog
        open={!!losing}
        label={String(losing?.public_ref || losing?.title || tr("Request"))}
        onClose={() => setLosing(null)}
        onLost={async (code, reason) => {
          if (!losing) return;
          await moveStage(losing.quote_request_id, { stage: "LOST", lost_reason_code: code, ...(reason ? { lost_reason: reason } : {}) });
          res.reload();
        }}
      />
    </DndContext>
  );
}

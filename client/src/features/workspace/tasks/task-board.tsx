/**
 * The task board — one column per status, cards you can drag between them.
 *
 * ── DRAG IS A SHORTCUT, NOT THE MECHANISM ──────────────────────────────────
 *
 * Every card also carries a status picker, so moving a task is available to a
 * keyboard, to a screen reader and to a touch screen where dragging a small
 * target is fiddly. A board whose only affordance is the pointer fails
 * FRONTEND_GUIDE §7.3 ("keyboard and pointer parity") however well it feels
 * with a mouse. The picker is therefore not a fallback that happens to be
 * there; it is the control, and dragging is the faster way to reach it.
 *
 * ── WHY `activationConstraint.distance` IS SET ─────────────────────────────
 *
 * Without it, a click IS a drag start, so the controls inside the card can
 * never be clicked and every card is "dragging" the moment the pointer goes
 * down. Eight pixels is below the threshold anyone notices and above the
 * jitter of a finger landing on glass.
 *
 * ── THE WHOLE CARD OPENS IT, AND THE DRAG HANDLE IS A SEPARATE BOX ─────────
 *
 * A card's job is to be read and then opened, so the target is the card and not
 * the 20px line of its title: the title, the pills, the date and the assignee
 * are all inside ONE `<button>`, which is what makes "click anywhere on the
 * card" true rather than approximately true.
 *
 * The grip is the title strip, laid OVER that button as a sibling — not as its
 * ancestor, and not as a `::after` on the title. Both alternatives put the drag
 * handle's `touch-action: none` in the tree ABOVE the click target, and
 * `touch-action` is intersected up from the element under the finger: the card
 * would then refuse to scroll the board on a phone, so a reader flicking
 * through a full column would drag cards instead. A sibling passes the gesture
 * through, and it also splits the two interactions cleanly — a pointerup that
 * ends a drag lands on the grip, whose only listener is dnd-kit's, so the click
 * a drag would otherwise leave behind opens nothing. That is a structural fix
 * rather than a timing one.
 *
 * ── THE OPEN CARD IS MARKED, AND THE PANE IS ITS OTHER HALF ────────────────
 *
 * The card in the pane wears `<IndexRow>`'s pair — the `.index-row-open` ground
 * and the 3px `--primary` rail — and `aria-current`, so "which task is the pane
 * showing" is answered on the board as well as in the pane. Guide §3.14 is
 * explicit that a master-detail screen has to say what is open, and that the
 * meaning of "this is the open one" is shared even when the geometry is local:
 * a card is not an `<IndexRow>` (it carries a Move menu), so it borrows
 * `INDEX_ROW_OPEN` and positions the rail itself, exactly as the inbox thread
 * row does.
 *
 * `bg-card` is deliberately NOT applied to a selected card. It is a Tailwind
 * utility and `.index-row-open` lives in `@layer components`, so the utility
 * would win and the open card would look like every other card — the F13 defect
 * the ground exists to fix.
 *
 * ── WHY THE BOARD IS NOT THE PAGINATED LIST ────────────────────────────────
 *
 * Lists here are capped at 50 rows server-side (API F-26). A kanban over that
 * cap shows four columns of the wrong rows and gives no indication anything is
 * missing, which is exactly the bug the cap's `X-Total-Count` header was added
 * to end. The board endpoint returns up to 200 open tasks in one response and
 * is the honest shape for this view.
 */
import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { INDEX_ROW_OPEN } from "@/components/ui/index-row";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { BOARD_COLUMNS } from "../api";
import type { BoardColumn, Task, TaskBoard, TaskStatus } from "../api";
import { useMoveTask } from "../hooks";
import { COLUMN_LABEL, PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL } from "../labels";

export function TaskBoard({
  board,
  loading,
  selectedId,
  onOpen,
  onCreate,
}: {
  board: TaskBoard | undefined;
  loading: boolean;
  /** The task the detail pane is showing, so the board can say which one it is. */
  selectedId: string | null;
  onOpen: (taskId: string) => void;
  onCreate: () => void;
}) {
  const move = useMoveTask();
  const toast = useToast();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Space to pick up, arrows to choose a column, space to drop. This is what
    // makes the board reachable without a pointer at all.
    useSensor(KeyboardSensor),
  );

  const active = activeId ? findTask(board, activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over?.id ? String(e.over.id) : null;
    const task = findTask(board, String(e.active.id));
    if (!task || !over || over === task.status) return;
    try {
      await move.mutateAsync({ id: task.task_id, status: over as TaskStatus });
    } catch (err) {
      // The board re-reads from the server on success; on failure the card is
      // simply still where it was, and the user is told why it did not move.
      toast.error(errMsg(err));
    }
  }

  if (loading && !board) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((c) => (
          <div key={c} className="rounded-lg border p-3">
            <div className="micro mb-3">{COLUMN_LABEL[c]}</div>
            <LoadingRow label="Loading tasks…" />
            <LoadingRow />
          </div>
        ))}
      </div>
    );
  }

  const total = BOARD_COLUMNS.reduce((n, c) => n + (board?.[c]?.length ?? 0), 0);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((column) => (
          <Column
            key={column}
            column={column}
            tasks={board?.[column] ?? []}
            selectedId={selectedId}
            onOpen={onOpen}
            onMove={async (id, status) => {
              try {
                await move.mutateAsync({ id, status });
              } catch (err) {
                toast.error(errMsg(err));
              }
            }}
            onCreate={onCreate}
          />
        ))}
      </div>

      {/* The moving copy. The source card stays where it is and dims, so the
          user never loses track of where the task came from. */}
      <DragOverlay>
        {active ? <TaskCard task={active} overlay /> : null}
      </DragOverlay>

      {total === 0 && (
        <div className="mt-6">
          <EmptyState
            title="Nothing on the board"
            hint="Tasks you write, or that are assigned to you, land here in the column that matches how far along they are."
            action={
              <button type="button" className="btn-primary" onClick={onCreate}>
                Add the first task
              </button>
            }
          />
        </div>
      )}
    </DndContext>
  );
}

function Column({
  column,
  tasks,
  selectedId,
  onOpen,
  onMove,
  onCreate,
}: {
  column: BoardColumn;
  tasks: Task[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => Promise<void>;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${COLUMN_LABEL[column]} — ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      className={cn(
        "flex min-h-[12rem] flex-col rounded-lg border bg-card/40 p-3 transition-colors",
        isOver && "border-primary bg-accent ring-1 ring-primary",
      )}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        {/* `h2`, not `h3`: the board sits directly under the page's `<h1>`
            (`PageHeader`), so a column heading one level down skipped a level
            and axe fails the screen on `heading-order`. The four columns and
            the open task's `<Panel>` are siblings in the outline — all of them
            are what the page is made of. */}
        <h2 className="text-sm font-medium">{COLUMN_LABEL[column]}</h2>
        <span className="micro num" aria-hidden>
          {tasks.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.task_id}
            task={task}
            selected={task.task_id === selectedId}
            dimmed={task.status !== column}
            onOpen={() => onOpen(task.task_id)}
            onMove={onMove}
          />
        ))}

        {tasks.length === 0 && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md border border-dashed px-3 py-4 text-center micro transition-colors hover:border-primary hover:text-primary-ink"
          >
            Drop here, or add a task
          </button>
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  selected = false,
  onOpen,
  onMove,
  overlay = false,
  dimmed = false,
}: {
  task: Task;
  /** Is the detail pane showing THIS task? */
  selected?: boolean;
  onOpen?: () => void;
  onMove?: (id: string, status: TaskStatus) => Promise<void>;
  /** The copy that follows the pointer. Not interactive, not draggable. */
  overlay?: boolean;
  dimmed?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.task_id,
    // The overlay copy is not itself draggable — dragging the drag is a loop.
    disabled: overlay || !onMove,
  });

  const overdue =
    task.due_at && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_at) < new Date();

  const live = !overlay;

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      className={cn(
        "group relative rounded-md border shadow-sm transition-opacity",
        selected
          ? cn(
              INDEX_ROW_OPEN,
              // The rail, positioned here rather than borrowed from
              // `<IndexRow>`: a flush list row and a bordered card want
              // different insets, while the MEANING of the open one is shared.
              "before:absolute before:inset-y-2 before:left-1 before:w-[3px] before:rounded-full before:content-['']",
            )
          : "bg-card",
        isDragging && live && "opacity-40",
        dimmed && live && "opacity-60",
        overlay && "rotate-1 shadow-lg ring-1 ring-primary",
      )}
    >
      {/*
        ONE BUTTON IS THE WHOLE CARD. Everything a reader might click —
        the title, the priority pill, the date, the owner's name — is inside it,
        so the hit area IS the card rather than the title line. `<span>`s rather
        than `<div>`s because a button may only contain phrasing content, and
        the pills are spans for the same reason.
      */}
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        // The board's half of the master-detail bond, and the half a screen
        // reader can hear: the ground and rail say it to the eye.
        aria-current={selected ? "true" : undefined}
        title={task.title}
        className={cn(
          "block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // The Move menu sits below the button in the flow; the button gives
          // back the bottom padding the row would otherwise double.
          live && onMove ? "px-3 pt-3 pb-2" : "p-3",
          live && onOpen && "cursor-pointer",
        )}
      >
        <span className={cn("block truncate text-sm font-medium", live && onOpen && "group-hover:text-primary-ink")}>
          {task.title}
        </span>

        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Pill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Pill>
          {task.due_at && (
            <span className={cn("num text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
              {overdue ? "Overdue · " : ""}
              {dateFmt(task.due_at)}
            </span>
          )}
          {task.subtask_count > 0 && (
            <span className="num text-xs text-muted-foreground">
              {task.subtask_done_count}/{task.subtask_count}
            </span>
          )}
          {task.assigned_to_name && (
            <span className="truncate text-xs text-muted-foreground">{task.assigned_to_name}</span>
          )}
          {task.entity_label && <Pill tone="blue">{task.entity_label}</Pill>}
        </span>
      </button>

      {/*
        The grip, over the title strip. A sibling of the button and not an
        ancestor of it, so the card's click target and the drag gesture's
        `touch-action` do not overlap (see the file header). Its height matches
        the title's line box, which is what makes it cover the title and
        nothing else. It carries a NAME of its own: dnd-kit gives it
        `role="button"` and the drag instructions, but an icon-less box has no
        text to be named by.
      */}
      {live && onOpen && onMove && (
        <div
          {...listeners}
          {...attributes}
          aria-label={`Drag “${task.title}”`}
          className="absolute left-3 right-3 top-3 h-5 cursor-grab touch-none active:cursor-grabbing"
        />
      )}

      {/* The keyboard route. A real menu rather than a hover affordance,
          because a control that only appears on pointer-hover does not exist
          for a keyboard user (FRONTEND_GUIDE §7.3). */}
      {live && onMove && (
        <div className="flex justify-end px-3 pb-3">
          <DropdownMenu
            align="end"
            trigger={
              <Button size="sm" variant="outline" aria-label={`Move “${task.title}” to another column`}>
                Move
              </Button>
            }
          >
            {BOARD_COLUMNS.filter((c) => c !== task.status).map((c) => (
              <DropdownItem key={c} onSelect={() => void onMove(task.task_id, c)}>
                {STATUS_LABEL[c]}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </div>
      )}
    </article>
  );
}

function findTask(board: TaskBoard | undefined, id: string): Task | null {
  if (!board) return null;
  for (const column of BOARD_COLUMNS) {
    const hit = board[column]?.find((t) => t.task_id === id);
    if (hit) return hit;
  }
  return null;
}

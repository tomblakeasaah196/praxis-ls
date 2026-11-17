/**
 * A lead's next step is completed on the lead, not here
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, "The loop that makes it used").
 *
 * The step is an ordinary task (`entity_type = 'lead'`), so My Workspace shows
 * it in Today and Tasks with its reminder. But Done on a lead's step asks what
 * happened and what is next, in one write, so the company is never left open
 * without a dated step. Marking the task done here would skip both questions.
 * So every gesture that would move such a task to DONE (the list's checkbox,
 * the board's drag, the panel's status picker) opens the lead's Done dialog
 * instead, through `/sales/leads/<id>?done=<task_id>`.
 */
type TaskLike = { task_id: string; entity_type?: string | null; entity_id?: string | null };

/** The lead's Done dialog for this task, or null when the move is an ordinary one. */
export function leadDoneUrl(task: TaskLike | null | undefined, nextStatus: string): string | null {
  if (!task || nextStatus !== "DONE") return null;
  if (task.entity_type !== "lead" || !task.entity_id) return null;
  return `/sales/leads/${encodeURIComponent(task.entity_id)}?done=${encodeURIComponent(task.task_id)}`;
}

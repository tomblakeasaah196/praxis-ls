/**
 * A lead's next step, as a My Workspace task (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §4.4, owner decision D4).
 *
 * A next step is an ORDINARY task: entity_type 'lead', on its owner's desk, due
 * when the salesperson said, with a reminder fifteen minutes before. It shows in
 * My Workspace › Today and the reminder sweep fires it, with no Sales code of
 * its own. `lead.next_step_task_id` points at the current one, and only the
 * lead service moves that pointer.
 *
 * The rows are written through the workspace's own repo and reminder writer,
 * on the CALLER's transaction: a next step lands with the lead write that asked
 * for it, or not at all. The workspace service's createTask is not used because
 * it is a request handler's function (a caller context, the caller's audience)
 * and it notifies outside any transaction; this file emits the same events and
 * audit lines under the same keys.
 */
"use strict";

const tasksRepo = require("../../dashboard/workspace/tasks.repo");
const tasksService = require("../../dashboard/workspace/tasks.service");
const workspaceEvents = require("../../dashboard/workspace/workspace.events");
const { timezoneOf, toInstant } = require("../../dashboard/workspace/workspace.time");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");

/** Minutes before the step that its reminder fires. */
const REMINDER_MINUTES = 15;

/** A bare day means the start of the working morning, not midnight. */
const DATE_ONLY_TIME = "09:00:00";

/** Statuses in which a task is no longer somebody's next step. */
const CLOSED = new Set(["DONE", "CANCELLED"]);

/** The instant a step is due, on the tenant's clock, or a 422 naming the field. */
async function dueInstant(client, raw) {
  const timeZone = await timezoneOf(client);
  const at = toInstant(raw, { timeZone, dateOnlyTime: DATE_ONLY_TIME });
  if (!at) {
    throw new AppError("VALIDATION_ERROR", "The next step needs a date", 422, { "next_step.due_at": ["not a readable date"] });
  }
  return { at, timeZone };
}

/** The live task behind a pointer, or null when it is gone, done or cancelled. */
async function current(client, taskId) {
  if (!taskId) return null;
  const row = await tasksRepo.findTask(client, taskId);
  if (!row || CLOSED.has(row.status)) return null;
  return row;
}

/**
 * Write a next step. `createdBy` must be a user the schema knows (a task's
 * creator is NOT NULL): the actor when there is one, else the person it is for.
 */
async function create(client, { leadId, action, dueAt, assignedTo, createdBy }) {
  const assignee = await resolveActorId(client, assignedTo);
  const creator = (await resolveActorId(client, createdBy)) || assignee;
  if (!creator) {
    throw new AppError("NO_OWNER", "Nobody can own this next step: give the lead an owner", 422, { owner_user_id: ["required for a next step"] });
  }
  const { at, timeZone } = await dueInstant(client, dueAt);
  const row = await tasksRepo.insertTask(client, {
    title: String(action).trim().slice(0, 300),
    status: "TO_DO",
    priority: "NORMAL",
    assigned_to: assignee || creator,
    created_by: creator,
    due_at: at,
    entity_type: "lead",
    entity_id: leadId,
  });
  await tasksService.writeReminders(client, {
    ownerType: "task", ownerId: row.task_id,
    input: { reminders: [{ reminder_minutes: REMINDER_MINUTES }] },
    anchor: at, timeZone, actor: { user_id: creator },
  });
  await emitEvent(client, {
    eventTypeKey: workspaceEvents.TASK_CREATED, moduleKey: workspaceEvents.MODULE,
    entityRef: `task:${row.task_id}`, actorUserId: creator,
    payload: { status: row.status, priority: row.priority, entity_ref: `lead:${leadId}` },
  });
  await audit(client, {
    actorUserId: creator, action: workspaceEvents.TASK_CREATED, moduleKey: workspaceEvents.MODULE,
    entityRef: `task:${row.task_id}`, after: { title: row.title, due_at: row.due_at, entity_ref: `lead:${leadId}` },
  });
  return row;
}

/** Change what a live step says, when, or whose it is; its reminder moves with it. */
async function reschedule(client, { taskId, action, dueAt, assignedTo, actorId }) {
  const patch = {};
  if (action) patch.title = String(action).trim().slice(0, 300);
  if (dueAt) patch.due_at = (await dueInstant(client, dueAt)).at;
  if (assignedTo !== undefined) {
    const assignee = await resolveActorId(client, assignedTo);
    if (assignee) patch.assigned_to = assignee;
  }
  const row = await tasksRepo.updateTask(client, taskId, patch);
  if (patch.due_at) await tasksRepo.rearmOwnerReminders(client, "task", taskId);
  await emitEvent(client, {
    eventTypeKey: workspaceEvents.TASK_UPDATED, moduleKey: workspaceEvents.MODULE,
    entityRef: `task:${taskId}`, actorUserId: actorId || null, payload: { fields: Object.keys(patch) },
  });
  return row;
}

/**
 * Close a step: DONE when it was done, CANCELLED when the lead is archived or
 * the step is replaced. Its armed reminders are stamped, as a finished task's
 * are, so nobody is reminded of work that no longer exists.
 */
async function close(client, { taskId, status = "DONE", actorId = null }) {
  const before = await tasksRepo.findTask(client, taskId);
  if (!before || CLOSED.has(before.status)) return before;
  const row = await tasksRepo.updateTask(client, taskId, { status });
  await tasksRepo.settleRemindersForDoneTask(client, taskId, new Date().toISOString());
  await emitEvent(client, {
    eventTypeKey: workspaceEvents.TASK_STATUS_CHANGED, moduleKey: workspaceEvents.MODULE,
    entityRef: `task:${taskId}`, actorUserId: actorId,
    payload: { from: before.status, to: status },
  });
  await audit(client, {
    actorUserId: actorId, action: workspaceEvents.TASK_STATUS_CHANGED, moduleKey: workspaceEvents.MODULE,
    entityRef: `task:${taskId}`, before: { status: before.status }, after: { status },
  });
  return row;
}

/**
 * Tell the person a step was put on their desk, when somebody else put it
 * there. A courtesy about a row that already committed: never thrown.
 */
async function tellAssignee(client, task) {
  if (!task || !task.assigned_to || task.assigned_to === task.created_by) return;
  try {
    await tasksService.notifyAssignee(client, { ...task, link_url: `/sales/leads/${task.entity_id}` });
  } catch (err) {
    logger.warn({ err, task_id: task.task_id }, "[lead] next step assignment notice not sent");
  }
}

module.exports = { create, reschedule, close, current, tellAssignee, REMINDER_MINUTES, CLOSED, dueInstant };

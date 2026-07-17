/**
 * Praxis assistant API — the in-screen AI (draft / suggest / carry out this
 * screen's actions). `askPraxis` returns an answer plus proposed action runs;
 * write actions come back AWAITING_CONFIRM and are executed (permission-
 * inheriting) via confirm. This is the per-screen surface, not a general chat.
 */
import { tenant } from "./api-client";

export type AiActionRun = {
  action_run_id: string;
  action_key: string;
  payload?: Record<string, unknown>;
  requires_confirmation?: boolean;
  validation_errors?: string[];
};

export type AskResult = {
  answer: string;
  actions: AiActionRun[];
  batch_id?: string | null;
  batch_size?: number;
  blocked?: boolean;
  gate?: { reason?: string };
};

export const askPraxis = (message: string, conversationId?: string) =>
  tenant<AskResult>("/ai/ask", { method: "POST", body: { message, conversation_id: conversationId } });

export const confirmAiAction = (actionRunId: string) =>
  tenant<{ ok: boolean; result?: unknown }>(`/ai/actions/${actionRunId}/confirm`, { method: "POST" });

export const confirmAiBatch = (batchId: string) =>
  tenant<{ batch_id: string; halted: boolean; executed: number; results: unknown[] }>(
    `/ai/batches/${batchId}/confirm`,
    { method: "POST" },
  );

/**
 * Per stage of a shipment, how many questions the client asked and how many
 * nobody has read (tenant review of 29 Sep 2026, PR 1, item 1.7) — the data
 * half of `stage-questions.tsx`, kept apart so that file exports only
 * components. Gated like the Client inbox (MOD-64C): the conversation's API
 * refuses anyone else, so nobody else is shown a count they could not open.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import { useCanUseModule } from "@/lib/route-access";
import { useRefreshEvent } from "@/lib/open-in-app";

export type StageCount = {
  milestone_instance_id: string;
  questions: number;
  unread: number;
  messages: number;
  last_at: string | null;
};

/** Per stage, how many questions the client asked and how many nobody has read. */
export function useStageQuestions(clientId: string | null | undefined, dossierId: string) {
  const allowed = useCanUseModule("MOD-64C");
  const on = !!clientId && allowed;
  const res = useResource<StageCount[]>(
    () =>
      on
        ? tenant<StageCount[]>(`/portal/chat/milestones?client_id=${encodeURIComponent(clientId as string)}&dossier_id=${encodeURIComponent(dossierId)}`)
        : Promise.resolve([]),
    [on, clientId, dossierId],
    { fresh: true },
  );
  useRefreshEvent((d) => {
    if (on && (d.scope === "screen" || d.clientId === clientId)) res.reload();
  });
  const byStage = React.useMemo(() => {
    const m = new Map<string, StageCount>();
    for (const row of Array.isArray(res.data) ? res.data : []) m.set(row.milestone_instance_id, row);
    return m;
  }, [res.data]);
  return { enabled: on, byStage, reload: res.reload };
}

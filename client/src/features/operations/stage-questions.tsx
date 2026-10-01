/**
 * A client's questions on each stage of a shipment, on the operations file
 * (tenant review of 29 Sep 2026, PR 1, item 1.7).
 *
 * A client can ask about one stage from the portal ("is Arrival in Douala
 * done?"); the message is filed with that stage's `milestone_instance_id`. The
 * panel that showed them was mounted only in Client 360 and the Client inbox,
 * so the people working the file never saw the question beside the stage it
 * was about. Here each stage carries a count of its questions and, opened,
 * the thread itself — with an inline reply that goes into the same shipment
 * conversation, named with the same stage, so the client reads it in the
 * portal where they asked. "Send by email" works on the team's replies here
 * as everywhere else.
 *
 * Gated like the Client inbox (MOD-64C): the conversation's API refuses anyone
 * else, so nobody else is shown a count they could not open.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, useResource } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useCanUseModule } from "@/lib/route-access";
import { useRefreshEvent } from "@/lib/open-in-app";
import { Bubble, type Message } from "@/features/portal/client-chat-panel";
import { SendByEmailDialog } from "@/features/portal/client-message-email";

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

/** "2 client questions · 1 new" — the stage's count, as a button that opens the thread. */
export function StageQuestionsToggle({ count, open, onToggle }: { count: StageCount | undefined; open: boolean; onToggle: () => void }) {
  if (!count || !count.messages) return null;
  const label =
    count.questions === 1 ? tr("1 client question") : tv("{{n}} client questions", { n: count.questions });
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Pill tone={count.unread ? "warn" : "blue"}>
        {count.unread ? `${label} · ${tv("{{n}} new", { n: count.unread })}` : label}
      </Pill>
    </button>
  );
}

type Page = { thread: string; has_more: boolean; messages: Message[] };

/** One stage's thread: its messages, and a reply that names the same stage. */
export function StageQuestionsThread({
  clientId,
  dossierId,
  milestoneId,
  stageLabel,
  onChanged,
}: {
  clientId: string;
  dossierId: string;
  milestoneId: string;
  stageLabel: string;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [page, setPage] = React.useState<Page | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [emailing, setEmailing] = React.useState<Message | null>(null);
  const sending = React.useRef(false);
  const q = `client_id=${encodeURIComponent(clientId)}&thread=${encodeURIComponent(dossierId)}`;

  const load = React.useCallback(async () => {
    try {
      const p = await tenant<Page>(`/portal/chat/messages?${q}`);
      setPage(p);
      setError(null);
      // Opening the stage's questions is reading them: the client sees "seen".
      if (p.messages.some((m) => m.direction === "CLIENT" && m.milestone?.milestone_instance_id === milestoneId)) {
        await tenant("/portal/chat/read", { method: "POST", body: { client_id: clientId, thread: dossierId } });
        onChanged?.();
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, [q, clientId, dossierId, milestoneId, onChanged]);

  React.useEffect(() => {
    void load();
  }, [load]);
  useRefreshEvent(() => void load());

  async function reply() {
    const body = draft.trim();
    if (!body || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await tenant("/portal/chat/messages", {
        method: "POST",
        body: { client_id: clientId, thread: dossierId, body, milestone_instance_id: milestoneId },
      });
      setDraft("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const mine = (page?.messages || []).filter((m) => m.milestone?.milestone_instance_id === milestoneId);
  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-muted/40 p-2">
      {error ? <ErrorState message={error} /> : null}
      {!page && !error ? <LoadingRow /> : null}
      {page && !mine.length ? (
        <p className="px-1 text-xs text-muted-foreground">{tr("Older questions on this stage are in the shipment's conversation in the Client inbox.")}</p>
      ) : null}
      {mine.length ? (
        <ul className="grid gap-2" aria-label={tv("Client questions on {{stage}}", { stage: stageLabel })}>
          {mine.map((m) => (
            <Bubble key={m.message_id} m={m} onEmail={setEmailing} />
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          rows={1}
          className="min-h-[40px] flex-1 resize-none"
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void reply();
            }
          }}
          placeholder={tv("Answer about {{stage}}…", { stage: stageLabel })}
          aria-label={tv("Answer about {{stage}}", { stage: stageLabel })}
          readOnly={busy}
        />
        <Button size="sm" loading={busy} disabled={!draft.trim()} onClick={() => void reply()}>
          {tr("Send")}
        </Button>
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">{tr("The client reads your answer in this shipment's conversation in their portal.")}</p>
      <SendByEmailDialog message={emailing} onClose={() => setEmailing(null)} onSent={() => void load()} />
    </div>
  );
}

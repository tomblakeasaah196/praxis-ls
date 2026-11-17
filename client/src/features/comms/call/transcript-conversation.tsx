/**
 * A call's transcript as a conversation: who said what, in order, with when.
 *
 * The server lays the two sides of a call on one clock and gathers what each
 * person said into turns (smartcomm.call.pipeline `buildTurns`). This draws
 * them: the time a turn began, the person, their words. It replaced "everything
 * the caller said, then everything the callee said", which a tenant read once
 * and asked for the order instead.
 *
 * Shown only when the transcript is `timed`. A call transcribed before the
 * times were kept has no turns, and both places that show a transcript keep
 * drawing its two blocks for it (owner decision: old calls stay as they are).
 */
import { tr, tv } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { CallTranscriptTurn } from "@/lib/smartcomm-api";
import { clockOf } from "./call-labels";

export function TranscriptConversation({ turns, compact = false }: {
  turns: CallTranscriptTurn[];
  /** The card in a chat thread: the same conversation, a size smaller. */
  compact?: boolean;
}) {
  const body = compact ? "text-xs" : "text-sm";
  return (
    <ol className={cn("list-none", compact ? "space-y-2" : "space-y-3")} data-transcript="conversation">
      {turns.map((t, i) => {
        const who = t.name || (t.side === "caller" ? tr("Caller") : tr("Callee"));
        return (
          <li key={`${t.side}-${t.at_s}-${i}`} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3">
            <time className={cn("pt-0.5 font-mono tabular-nums text-muted-foreground", compact ? "text-micro" : "text-xs")}>
              {clockOf(t.at_s)}
            </time>
            <div className="min-w-0">
              {/* Two people, told apart by more than position: the caller's
                  name carries the accent ink, the callee's the plain one. */}
              <div className={cn("font-semibold", body, t.side === "caller" ? "text-primary-ink" : "text-foreground")}>
                {who}
                {t.exact === false && !t.gap && (
                  <span className="ml-1.5 text-micro font-normal text-muted-foreground">{tr("time approximate")}</span>
                )}
              </div>
              {t.gap ? (
                <div className={cn("italic text-muted-foreground", body)}>
                  {tv("Not transcribed until {{time}}", { time: clockOf(t.to_s ?? t.at_s) })}
                </div>
              ) : (
                <div className={cn("whitespace-pre-wrap text-foreground", body)}>{t.text}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One meeting, opened from a lead's Activity (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.2): today's discovery capture, unchanged (three sections, per-section
 * dictation), and the notes and minutes beside it.
 *
 * It lived on the Meetings tab, which the lean revamp folded into the Lead 360:
 * a meeting is scheduled from the lead and read from its Activity. The two
 * records are kept apart on purpose. Discovery is the structured capture a
 * quotation's Your Needs and Our Solution are drafted from; notes are the
 * ordinary trail. A draft made from free text is a draft made from whatever
 * the salesperson happened to write down.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, dateFmt, dateTimeFmt } from "@/lib/format";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { DiscoveryCapture } from "./meeting-discovery";

export function MeetingDialog({ meetingId, onClose, onChanged }: { meetingId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [isMinutes, setIsMinutes] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const [tab, setTab] = React.useState("discovery");

  React.useEffect(() => {
    if (!meetingId) return;
    let live = true;
    setData(null);
    setError(null);
    tenant<Row>(`/meetings/${meetingId}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [meetingId, tick]);

  React.useEffect(() => {
    setBody("");
    setIsMinutes(false);
    setTab("discovery");
  }, [meetingId]);

  async function addNote() {
    if (!meetingId || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/meetings/${meetingId}/notes`, { method: "POST", body: { body: body.trim(), is_minutes: isMinutes } });
      setBody("");
      setIsMinutes(false);
      setTick((t) => t + 1);
      onChanged?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const notes = (data?.notes as Row[] | undefined) || [];
  const when = data?.scheduled_at ? dateTimeFmt(String(data.scheduled_at)) : null;

  const notesPanel = (
    <div className="space-y-4 pt-4">
      {data === null && !error ? (
        <LoadingRow label={tr("Loading…")} />
      ) : notes.length === 0 ? (
        <EmptyState title={tr("No notes yet")} />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={String(n.meeting_note_id)} className="rounded-lg border p-3">
              <div className="mb-1 flex items-center gap-2">
                {n.is_minutes ? <Pill tone="blue">{tr("Minutes")}</Pill> : null}
                <span className="micro">{dateFmt(n.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{cell(n.body)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 border-t pt-4">
        <Field label={tr("Add Note")}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        </Field>
        <Checkbox checked={isMinutes} onCheckedChange={(v) => setIsMinutes(v === true)} label={tr("Mark as Minutes")} />
        <div className="flex justify-end">
          <Button onClick={() => void addNote()} loading={busy} disabled={!body.trim() || busy}>
            {tr("Add Note")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog
      open={!!meetingId}
      onClose={onClose}
      title={data?.subject ? String(data.subject) : tr("Meeting")}
      description={[when, data?.location ? String(data.location) : null].filter(Boolean).join(" · ") || undefined}
      size="xl"
    >
      {error ? <ErrorState message={error} /> : null}
      {meetingId ? (
        <Tabs
          value={tab}
          onValueChange={setTab}
          label={tr("Meeting Record")}
          tabs={[
            {
              value: "discovery",
              label: tr("Client Discovery"),
              content: (
                <div className="pt-4">
                  <DiscoveryCapture meetingId={meetingId} />
                </div>
              ),
            },
            { value: "notes", label: tr("Notes and Minutes"), content: notesPanel },
          ]}
        />
      ) : null}
    </Dialog>
  );
}

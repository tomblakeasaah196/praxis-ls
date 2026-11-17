/**
 * Company Profile, Share (guide §3.6 Outputs 3): a link per recipient or lead,
 * with a last day, opens tracked and Revoke.
 *
 * The link is shown ONCE, when it is made: only a hash of it is stored, so it
 * cannot be shown again. Lost it? Make another and revoke the first.
 */
import * as React from "react";
import { companyProfile } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { DateField } from "@/components/ui/date-field";
import { SearchSelect } from "@/components/ui/search-select";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { dateFmt, dateTimeFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/company-profile-api";

const PAGE = 25;

/** ISO day `days` from today, for the default last day. */
function isoIn(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const STATE_LABEL: Record<api.Share["state"], string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
};
const STATE_TONE: Record<api.Share["state"], Tone> = { ACTIVE: "ok", EXPIRED: "mute", REVOKED: "bad" };

export function ShareDialog({
  open,
  onClose,
  published,
}: {
  open: boolean;
  onClose: () => void;
  published: api.VersionSummary | null;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [leadId, setLeadId] = React.useState<string | null>(null);
  const [leadName, setLeadName] = React.useState("");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [language, setLanguage] = React.useState<api.Lang>("EN");
  const [lastDay, setLastDay] = React.useState(isoIn(30));
  const [pin, setPin] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [made, setMade] = React.useState<{ url: string; share: api.Share } | null>(null);

  const [rows, setRows] = React.useState<api.Share[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [listError, setListError] = React.useState<string | null>(null);
  const [openRow, setOpenRow] = React.useState<string | null>(null);
  const [opens, setOpens] = React.useState<api.ShareOpen[] | null>(null);

  const load = React.useCallback(async (at: number) => {
    setListError(null);
    try {
      const page = await api.listShares(at);
      setRows(page.data);
      setTotal(page.total ?? page.data.length);
      setOffset(at);
    } catch (e) {
      setListError(errMsg(e));
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setMade(null);
    setErrors({});
    void load(0);
  }, [open, load]);

  async function create() {
    const body = {
      lead_id: leadId,
      recipient_name: name.trim() || null,
      recipient_email: email.trim() || null,
      language,
      expires_on: lastDay,
      pin_version: pin,
    };
    // The shared schema, so the dialog refuses exactly what the API refuses.
    const parsed = companyProfile.share.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const issue of parsed.error.issues) out[String(issue.path[0] ?? "form")] = issue.message;
      setErrors(out);
      return;
    }
    setErrors({});
    try {
      const res = await api.createShare(body);
      setMade({ url: `${window.location.origin}${res.path}`, share: res.share });
      setLeadId(null);
      setLeadName("");
      setName("");
      setEmail("");
      await load(0);
    } catch (e) {
      setErrors({ form: errMsg(e) });
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tr("Link copied"));
    } catch {
      /* @silent:storage: a browser that refuses the clipboard still shows the link to select */
      toast.info(tr("Select the link and copy it"));
    }
  }

  async function revoke(row: api.Share) {
    const who = row.lead_name || row.recipient_name || row.recipient_email || "";
    const ok = await confirm({
      title: tr("Revoke this link?"),
      body: `${who}: ${tr("the link stops working at once, for everyone who has it.")}`,
      confirmLabel: tr("Revoke Link"),
      cancelLabel: tr("Keep It"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.revokeShare(row.share_id);
      await load(offset);
    } catch (e) {
      setListError(errMsg(e));
    }
  }

  async function showOpens(row: api.Share) {
    if (openRow === row.share_id) {
      setOpenRow(null);
      return;
    }
    setOpenRow(row.share_id);
    setOpens(null);
    try {
      setOpens((await api.shareOpens(row.share_id)).opens);
    } catch (e) {
      setListError(errMsg(e));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Share Company Profile")}
      description={tr("Each link is for one recipient or lead. Opens are recorded, and the first one notifies you.")}
      size="lg"
    >
      {!published ? (
        <EmptyState title={tr("Publish the profile before sharing it")} />
      ) : (
        <div className="space-y-6">
          {made ? (
            <div className="space-y-2 rounded-md border border-ok/40 bg-ok-fill/10 p-3" role="status">
              <p className="text-sm font-medium">{tr("Link ready. It is shown once.")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input readOnly value={made.url} aria-label={tr("Share link")} className="min-w-0 flex-1" onFocus={(e) => e.target.select()} />
                <Button size="sm" onClick={() => copy(made.url)}>{tr("Copy Link")}</Button>
                {made.share.recipient_email ? (
                  <a
                    className="text-sm text-primary-ink underline"
                    href={`mailto:${made.share.recipient_email}?body=${encodeURIComponent(made.url)}`}
                  >
                    {tr("Email It")}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tr("Lead")} about={tr("Optional. A link raised for a lead is listed against it.")}>
              <SearchSelect
                path="/leads"
                label={tr("Lead")}
                value={leadName}
                placeholder={tr("Search leads…")}
                getLabel={(r) => String(r.company_name ?? "")}
                getKey={(r) => String(r.lead_id)}
                onSelect={(r) => {
                  setLeadId(String(r.lead_id));
                  setLeadName(String(r.company_name ?? ""));
                }}
              />
            </Field>
            <Field label={tr("Recipient Name")} error={errors.recipient_name}>
              <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={tr("Recipient Email")} error={errors.recipient_email}>
              <Input type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={tr("Last Day")} error={errors.expires_on}>
              <DateField value={lastDay} min={isoIn(0)} max={isoIn(companyProfile.LIMITS.share_days)} onChange={setLastDay} required />
            </Field>
            <Field label={tr("Language")}>
              <Segmented
                label={tr("Language")}
                value={language}
                options={[{ value: "EN", label: "EN" }, { value: "FR", label: "FR" }]}
                onChange={setLanguage}
              />
            </Field>
            <div className="flex items-end">
              <Checkbox
                checked={pin}
                label={tv("Keep v{{n}}", { n: published.number })}
                about={tr("Ticked, the link keeps showing this version after the next publish. Unticked, it shows whatever is published.")}
                onCheckedChange={setPin}
              />
            </div>
          </div>
          {errors.form ? <ErrorState message={errors.form} /> : null}
          <div className="flex justify-end">
            <Button onClick={create}>{tr("Create Link")}</Button>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{tr("Links")}</h3>
            {listError ? <ErrorState message={listError} /> : null}
            {rows === null ? (
              <LoadingRow />
            ) : rows.length === 0 ? (
              <EmptyState title={tr("No links yet")} />
            ) : (
              <ul className="divide-y rounded-md border">
                {rows.map((r) => (
                  <li key={r.share_id} className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {r.lead_name || r.recipient_name || r.recipient_email}
                      </span>
                      <Pill tone={STATE_TONE[r.state]}>{tr(STATE_LABEL[r.state])}</Pill>
                      <span className="text-xs text-muted-foreground">
                        {r.language}
                        {r.pinned_version ? ` · v${r.pinned_version}` : ""}
                        {` · ${tr("Until")} ${dateFmt(r.expires_at)}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {r.open_count} {tr(r.open_count === 1 ? "open" : "opens")}
                        {r.last_opened_at ? ` · ${tr("Last")} ${dateTimeFmt(r.last_opened_at)}` : ""}
                        {r.downloaded_at ? ` · ${tr("PDF downloaded")}` : ""}
                      </span>
                      <span className="ml-auto flex gap-1">
                        {r.open_count > 0 || r.downloaded_at ? (
                          <Button size="sm" variant="ghost" onClick={() => showOpens(r)}>
                            {openRow === r.share_id ? tr("Hide Opens") : tr("Show Opens")}
                          </Button>
                        ) : null}
                        {r.state === "ACTIVE" ? (
                          <Button size="sm" variant="ghost" onClick={() => revoke(r)}>
                            {tr("Revoke")}
                          </Button>
                        ) : null}
                      </span>
                    </div>
                    {openRow === r.share_id ? (
                      opens === null ? (
                        <LoadingRow />
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {opens.map((o) => (
                            <li key={o.open_id}>
                              {dateTimeFmt(o.opened_at)} · {o.kind === "DOWNLOAD" ? tr("PDF") : tr("Page")} · {o.agent_label}
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {total > PAGE ? (
              <div className="flex items-center justify-end gap-2 text-xs">
                <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE))}>
                  {tr("Previous")}
                </Button>
                <span>
                  {offset + 1} to {Math.min(offset + PAGE, total)} / {total}
                </span>
                <Button size="sm" variant="ghost" disabled={offset + PAGE >= total} onClick={() => load(offset + PAGE)}>
                  {tr("Next")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {confirmDialog}
    </Dialog>
  );
}

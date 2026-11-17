/**
 * Settings › Commercial › Default Sales Owner (setting `sales.default_owner`,
 * doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2).
 *
 * Who owns a website or portal request that no existing company row claims,
 * and so whose desk its "Answer website request" step lands on. Empty hands it
 * to the first CEO-role user (for SMART, the MD), which is what the API does
 * with no setting at all. The form refuses what the API refuses: the shared
 * `lead.defaultOwnerSetting` shape.
 */
import * as React from "react";
import { lead as leadShape } from "@shared";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { putSetting } from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { Panel } from "@/components/ui/panel";
import { Field } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

type Owner = { user_id: string | null; name: string | null };

async function readOwner(): Promise<Owner> {
  try {
    const row = await tenant<{ value?: { user_id?: string | null } }>("/settings/sales/default_owner");
    const id = row?.value?.user_id || null;
    if (!id) return { user_id: null, name: null };
    try {
      const u = await tenant<{ full_name?: string; email?: string }>(`/users/${encodeURIComponent(id)}`);
      return { user_id: id, name: u?.full_name || u?.email || null };
    } catch {
      /* @silent:degraded the name is a label; the id is what is saved */
      return { user_id: id, name: null };
    }
  } catch (e) {
    // Never set: the API falls back to the first CEO-role user.
    if ((e as { status?: number }).status === 404) return { user_id: null, name: null };
    throw e;
  }
}

export function DefaultSalesOwnerPanel() {
  const toast = useToast();
  const res = useResource(readOwner, []);
  const [owner, setOwner] = React.useState<Owner>({ user_id: null, name: null });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (res.data) setOwner(res.data);
  }, [res.data]);

  async function save(next: Owner) {
    const parsed = leadShape.defaultOwnerSetting.safeParse({ user_id: next.user_id });
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    try {
      await putSetting("sales", "default_owner", parsed.data);
      setOwner(next);
      toast.success(tr("Default sales owner saved"));
      res.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={tr("Default Sales Owner")}>
      {res.error ? (
        <ErrorState message={res.error} />
      ) : res.loading ? (
        <LoadingRow label={tr("Loading…")} />
      ) : (
        <div className="space-y-3">
          <Field
            label={tr("Owner of New Website Leads")}
            about={tr("Who owns a website or portal request that no company on file claims. Left empty, it goes to the managing director.")}
          >
            <SearchSelect
              path="/users"
              label={tr("Owner of New Website Leads")}
              value={owner.name}
              placeholder={tr("The managing director")}
              getKey={(u) => String(u.user_id)}
              getLabel={(u) => String(u.full_name || u.email || "")}
              onSelect={(u) => void save({ user_id: String(u.user_id), name: String(u.full_name || u.email || "") })}
            />
          </Field>
          {owner.user_id ? (
            <Button variant="ghost" size="sm" loading={busy} onClick={() => void save({ user_id: null, name: null })}>
              {tr("Clear")}
            </Button>
          ) : null}
          {error ? <ErrorState message={error} /> : null}
        </div>
      )}
    </Panel>
  );
}

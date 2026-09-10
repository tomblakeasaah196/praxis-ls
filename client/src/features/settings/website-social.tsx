/**
 * Settings › Website › Social — the links in the public footer.
 *
 * ── THE SCREEN IS THE REGISTRY ─────────────────────────────────────────────
 *
 * One row per platform this product knows how to render, all of them always
 * visible, each with a single URL field. There is no "add a platform" button
 * and no delete: paste a URL and the icon appears in the footer, clear the
 * field and it does not exist. That is the entire feature, and it has no empty
 * state to design because the form is the same whether nothing is filled in or
 * everything is.
 *
 * ── WHY THE URL IS CHECKED AGAINST THE PLATFORM'S OWN DOMAIN ──────────────
 *
 * A LinkedIn glyph, in the tenant's own footer, under their branding, pointing
 * at any URL at all, is a phishing primitive with the tenant's reputation
 * attached. Anyone who can reach this screen can already publish copy, so this
 * is not a privilege boundary — it is a guard against a mistake (a pasted
 * tracking link, a shortener, a typo'd domain) becoming a link customers trust
 * *because of the icon beside it*.
 *
 * The rule lives in `packages/shared/design/social.js`, so this field and the
 * API refuse exactly the same strings and the check here is genuine feedback
 * rather than decoration the server repeats.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { SOCIAL_PLATFORMS, isValidSocialUrl } from "@praxis/shared/design/social";
import { WebsiteNav } from "./website-nav";

export function WebsiteSocialPage() {
  const [links, setLinks] = React.useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api
      .listSocial()
      .then((rows) => {
        const next: Record<string, string> = {};
        for (const p of SOCIAL_PLATFORMS) next[p.id] = "";
        for (const r of rows) next[r.platform] = r.url;
        setLinks(next);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errMsg(e)));
  }, []);

  React.useEffect(load, [load]);

  /** Only a NON-EMPTY value can be wrong. A blank field is how a tenant removes
   *  a link, so flagging it would make the remove gesture look like an error. */
  const invalid = React.useMemo(() => {
    if (!links) return {};
    const out: Record<string, boolean> = {};
    for (const p of SOCIAL_PLATFORMS) {
      const v = (links[p.id] || "").trim();
      out[p.id] = Boolean(v) && !isValidSocialUrl(p.id, v);
    }
    return out;
  }, [links]);

  const anyInvalid = Object.values(invalid).some(Boolean);

  async function save() {
    if (!links) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.saveSocial(links);
      setSaved(true);
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <ErrorState message={loadError} action={<Button onClick={load}>{tr("Try again")}</Button>} />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Social links")}
        description={tr(
          "Paste a link and it appears in your website footer. Leave one blank and it does not.",
        )}
      />
      <WebsiteNav />

      {!links ? null : (
        <>
          <SettingsCard
            title={tr("Footer links")}
            desc={tr("Each link must be on that platform's own domain, over https.")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_PLATFORMS.map((p) => (
                <Field key={p.id} label={p.name}>
                  <Input
                    value={links[p.id] ?? ""}
                    placeholder={p.placeholder}
                    aria-invalid={invalid[p.id] || undefined}
                    onChange={(e) => {
                      setSaved(false);
                      setLinks((l) => (l ? { ...l, [p.id]: e.target.value } : l));
                    }}
                  />
                  {invalid[p.id] && (
                    <p className="text-xs text-bad">
                      {tr("This is not a")} {p.name} {tr("link. Check the address.")}
                    </p>
                  )}
                </Field>
              ))}
            </div>
          </SettingsCard>

          {saveError && (
            <Callout tone="bad" title={tr("Not saved")}>
              {saveError}
            </Callout>
          )}
          {saved && !saveError && (
            <Callout tone="ok" title={tr("Saved")}>
              {tr("Your footer picks this up on the next page load.")}
            </Callout>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              {tr("Discard changes")}
            </Button>
            <Button onClick={save} disabled={busy || anyInvalid}>
              {busy ? tr("Saving…") : tr("Save links")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

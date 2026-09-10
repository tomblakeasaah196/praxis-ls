/**
 * Insights — the tenant's articles, beside the pages they sit next to.
 *
 * ── WHY THIS SCREEN IS NEW AND THE FEATURE IS NOT ─────────────────────────
 *
 * `insight_article` (migration 12757), full CRUD at `/insights`, a publish verb
 * of its own, a public read at `/public/insights`, and two routes on the
 * marketing site — `/insights` and `/insights/:slug` — both of them in that
 * site's header navigation. Everything except a way to write one. The product
 * shipped a nav link to a page only curl could fill, and every tenant's
 * Insights page has been empty since.
 *
 * ── WHY IT LIVES UNDER /settings/website ──────────────────────────────────
 *
 * An article is website content. Putting it under a separate Content area would
 * mean a tenant learning that their site is edited in two unrelated places, and
 * the settings ribbon holds only the handful of editors an administrator opens
 * daily — a third card in the grid would have been as findable as the second
 * one was, which is to say not very. `WebsiteNav` makes pages and articles two
 * halves of one screen.
 *
 * ── PUBLISHING IS A ROW ACTION ────────────────────────────────────────────
 *
 * Same rule as the pages screen, for the same reason: the API gives publishing
 * its own endpoint precisely so an ordinary field edit cannot flip it, and it
 * stamps who and when. A deliberate action with a sentence naming the outcome,
 * never a toggle somebody brushes past on the way to fixing a typo.
 *
 * ── AND SO IS PINNING (13784, guide §6.4) ─────────────────────────────────
 *
 * An ANNOUNCEMENT is an article with `kind = 'announcement'` — the same editor,
 * the same publish verb, the same public URL, a different renderer. Pinning one
 * puts it in the band under the tenant's hero, and `pinned_until` is not a
 * column a PATCH may write, so it gets the same treatment publishing does: its
 * own action, its own endpoint, its own audit record.
 *
 * THE EXPIRY IS SHOWN IN THE LIST, NOT ONLY IN THE DIALOG. A pin is temporary
 * by construction (13784 chose a timestamp over a boolean precisely so a March
 * pin is not still on the front page in November) and the only person who can
 * notice it going stale is looking at THIS screen, because nobody reads their
 * own homepage. So the date is on the row, and a pin whose date has passed
 * reads as expired rather than as pinned.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ListPage } from "@/components/list-page";
import { type Column } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { FormButtons } from "@/components/ui/form-buttons";
import { Segmented } from "@/components/ui/segmented";
import { Modal, ConfirmDialog, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { HubCrumb } from "@/components/tabbed-hub";
import { useList, useRefresh, errMsg } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/insights-api";
import * as site from "@/lib/site-content-api";
import { WebsiteNav } from "./website-nav";

/** Publishing needs a slug and a body, and the server refuses without them.
 *  Saying so in the list is cheaper than a 422 the writer reads after pressing
 *  a button they expected to work. */
const readyToPublish = (r: api.InsightArticle) =>
  Boolean((r.slug_fr || r.slug_en) && (r.body_fr || r.body_en));

/** The filter's three states. `all` is not a kind — it is the absence of the
 *  filter, which is why it cannot be typed as `InsightKind`. */
type KindFilter = "all" | api.InsightKind;

export function WebsiteInsightsPage() {
  const { rows, error, loading } = useList<api.InsightArticle>("/insights");
  const refresh = useRefresh();
  const nav = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const [publishing, setPublishing] = React.useState<api.InsightArticle | null>(null);
  const [pinning, setPinning] = React.useState<api.InsightArticle | null>(null);
  const [deleting, setDeleting] = React.useState<api.InsightArticle | null>(null);
  /* Filtered HERE rather than by re-fetching with `?kind=`.
     The server accepts the parameter — the settings list is a page of a few
     dozen rows a tenant has written, so narrowing it is a local concern, and a
     round trip per segment press would make the control feel like navigation.
     The query parameter earns its keep for the PUBLIC read, where the row count
     is unbounded. */
  const [kind, setKind] = React.useState<KindFilter>("all");

  /* A row written before 13784 has no `kind` on it if it came from a cache;
     the column's DEFAULT means the server always sends one, and treating a
     missing value as `article` is what stops such a row vanishing from every
     segment of the filter. */
  const shown = React.useMemo(
    () =>
      (rows ?? []).filter((r) => kind === "all" || (r.kind || "article") === kind),
    [rows, kind],
  );
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<site.SiteMeta | null>(null);

  React.useEffect(() => {
    let alive = true;
    // Uncached, like the pages screen: a screen ABOUT the website should notice
    // the package being switched on without a reload. A 403 (MOD-29 edit but
    // not view) simply leaves the notice undrawn.
    site
      .fetchSiteMeta()
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
  }, []);

  async function run(fn: () => Promise<unknown>, done: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      refresh();
      done();
    } catch (err) {
      // errMsg, never String(err): it turns the 403 into the permission
      // sentence and the 422 into the field list the API actually sent.
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<api.InsightArticle>[] = [
    {
      key: "title_fr",
      label: tr("Title"),
      render: (r) => (
        <span className="font-medium text-foreground">{r.title_fr}</span>
      ),
    },
    {
      key: "slug_fr",
      label: tr("Address"),
      // The slug is what the URL is made of, so it is set in the mono face like
      // every other machine value in the product. No slug is a normal state for
      // a draft and says so, rather than showing an empty cell that reads as
      // missing data.
      render: (r) =>
        r.slug_fr || r.slug_en ? (
          <span className="font-mono text-xs">{r.slug_fr || r.slug_en}</span>
        ) : (
          <span className="text-muted-foreground">{tr("Not set")}</span>
        ),
    },
    {
      key: "tags",
      label: tr("Tags"),
      render: (r) =>
        r.tags?.length ? (
          <span className="text-xs">{r.tags.join(", ")}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "kind",
      label: tr("Kind"),
      render: (r) =>
        r.kind === "announcement" ? (
          <Pill tone="blue">{tr("Announcement")}</Pill>
        ) : (
          <span className="text-muted-foreground">{tr("Article")}</span>
        ),
    },
    {
      key: "is_published",
      label: tr("State"),
      render: (r) => (
        <Pill tone={r.is_published ? "ok" : "mute"}>
          {r.is_published ? tr("Published") : tr("Draft")}
        </Pill>
      ),
    },
    {
      key: "pinned_until",
      label: tr("Home page"),
      /* THE EXPIRY, INLINE. Three states, and the middle one is the reason this
         column exists: an expired pin looks exactly like a live pin in the
         database and means the opposite on the site. Showing "until 4 March"
         beside a live pin is what lets somebody notice it is nearly up; showing
         "expired" is what lets them notice it already is. */
      render: (r) => {
        if (api.isPinned(r)) {
          return (
            <span className="whitespace-nowrap text-xs">
              <Pill tone="ok">{tr("Pinned")}</Pill>{" "}
              <span className="text-muted-foreground">
                {/* tr() takes one argument — no interpolation — so the label and
                    the date are concatenated rather than templated. */}
                {tr("until") + " " + fmtDay(r.pinned_until)}
              </span>
            </span>
          );
        }
        if (r.pinned_until) {
          return (
            <span className="whitespace-nowrap text-xs">
              <Pill tone="warn">{tr("Pin expired")}</Pill>{" "}
              <span className="text-muted-foreground">{fmtDay(r.pinned_until)}</span>
            </span>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => nav(`/settings/website/articles/${r.insight_article_id}`)}
          >
            {tr("Edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            // Disabled rather than hidden: a writer needs to know the button
            // exists and what it is waiting for, which the title says.
            disabled={!r.is_published && !readyToPublish(r)}
            title={
              !r.is_published && !readyToPublish(r)
                ? tr("Give it an address and a body first.")
                : undefined
            }
            onClick={() => setPublishing(r)}
          >
            {r.is_published ? tr("Unpublish") : tr("Publish")}
          </Button>
          {/* Offered only on an announcement, because only an announcement can
              be pinned — the server refuses the rest, and a button that exists
              to produce a 422 is a button that teaches people the screen is
              unreliable. Disabled rather than hidden on an unpublished one, so
              a writer can see the action and what it is waiting for. */}
          {r.kind === "announcement" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!r.is_published && !api.isPinned(r)}
              title={
                !r.is_published && !api.isPinned(r)
                  ? tr("Publish it first — the band only shows published announcements.")
                  : undefined
              }
              onClick={() => setPinning(r)}
            >
              {api.isPinned(r) ? tr("Edit pin") : tr("Pin to home page")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
            {tr("Delete")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <ListPage<api.InsightArticle>
      eyebrow={<HubCrumb area="Settings" to="/settings" />}
      title={tr("Insights")}
      description="Articles on your public site — what they are called, whether they are live, and what is in them."
      width="wide"
      tabs={<WebsiteNav />}
      action={<Button onClick={() => setCreating(true)}>{tr("New article")}</Button>}
      toolbar={
        <div className="flex w-full flex-col gap-3">
          <Segmented<KindFilter>
            label={tr("Show")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: tr("Everything") },
              { value: "article", label: tr("Articles") },
              { value: "announcement", label: tr("Announcements") },
            ]}
          />
          {meta && !meta.website_enabled ? (
            <Callout className="w-full" tone="warn" title={tr("The public site is off")}>
              Articles can be written and published here, but nothing serves them
              until the website package is switched on for this workspace.
            </Callout>
          ) : null}
        </div>
      }
      columns={columns}
      rows={shown}
      error={error}
      loading={loading}
      rowKey={(r) => r.insight_article_id}
      onRowClick={(r) => nav(`/settings/website/articles/${r.insight_article_id}`)}
      empty={
        /* Two different emptinesses. "Nothing written yet" and "nothing of this
           kind" need different sentences, and offering "New article" to
           somebody who has narrowed to Announcements and found none is an
           offer to make the wrong thing. */
        kind !== "all" && (rows ?? []).length
          ? {
              title:
                kind === "announcement"
                  ? tr("No announcements yet")
                  : tr("No articles yet"),
              hint:
                kind === "announcement"
                  ? "An announcement is an article with its kind set to Announcement — a partnership, a certification, a corridor opening. Pin one and it appears in the band under your home page's hero."
                  : "Everything here is currently an announcement. Clear the filter to see them.",
              action: (
                <Button variant="outline" onClick={() => setKind("all")}>
                  {tr("Show everything")}
                </Button>
              ),
            }
          : {
              title: tr("No articles yet"),
              hint: "Insights is in your site's navigation, so the page exists whether or not anything is on it. One article is enough to stop it being a dead link.",
              action: (
                <Button onClick={() => setCreating(true)}>{tr("New article")}</Button>
              ),
            }
      }
    >
      {creating && (
        <ArticleForm onClose={() => setCreating(false)} onSaved={refresh} />
      )}

      <ConfirmDialog
        open={!!publishing}
        onClose={() => setPublishing(null)}
        busy={busy}
        title={
          publishing?.is_published
            ? tr("Take this article off the site?")
            : tr("Publish this article?")
        }
        confirmLabel={
          publishing?.is_published ? tr("Unpublish") : tr("Publish")
        }
        destructive={Boolean(publishing?.is_published)}
        onConfirm={() =>
          run(
            () =>
              api.publishInsight(
                publishing!.insight_article_id,
                !publishing!.is_published,
              ),
            () => setPublishing(null),
          )
        }
        body={
          <>
            {publishing?.is_published
              ? "It stays here as a draft and its address stops answering. Anyone holding the link gets a not-found."
              : "It goes live at its address and appears on the Insights page of your site."}
            {actionError && <ErrorState message={actionError} />}
          </>
        }
      />

      {pinning && (
        <PinDialog
          row={pinning}
          busy={busy}
          error={actionError}
          onClose={() => {
            setPinning(null);
            setActionError(null);
          }}
          onSubmit={(until) =>
            run(() => api.pinInsight(pinning.insight_article_id, until), () =>
              setPinning(null),
            )
          }
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={busy}
        destructive
        title={tr("Delete this article?")}
        confirmLabel={tr("Delete")}
        onConfirm={() =>
          run(
            () => api.deleteInsight(deleting!.insight_article_id),
            () => setDeleting(null),
          )
        }
        body={
          <>
            The text goes with it and cannot be brought back. To take a
            published article off the site without losing it, unpublish it
            instead.
            {actionError && <ErrorState message={actionError} />}
          </>
        }
      />
    </ListPage>
  );
}

/** A pin's expiry, as a reader of this list wants it: a day, in their locale,
 *  with no time of day. The hour a pin lapses is not a decision anybody makes
 *  and showing it invites somebody to try. */
function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** `<input type="date">` speaks `YYYY-MM-DD` in LOCAL time; the API wants an
 *  instant. End of the chosen day, so "pinned until the 4th" includes the 4th —
 *  a pin that vanished at midnight on the morning of its own expiry date would
 *  be a day short of what the tenant asked for. */
const endOfDayIso = (day: string): string | null => {
  if (!day) return null;
  const d = new Date(`${day}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Tomorrow, as the date input's floor. The server refuses a past date
 *  (PIN_EXPIRED); saying so in the control is cheaper than saying it in a 422. */
const tomorrow = (): string =>
  new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

/**
 * The pin dialog — one date, and a way to take the pin off.
 *
 * ── WHY THE EXPIRY IS REQUIRED AND NOT OPTIONAL ────────────────────────────
 *
 * Migration 13784 chose a timestamp over a boolean because "featured" flags go
 * stale in silence: the JCTrans membership pinned in March is still on the
 * front page in November, and nobody notices because nobody reads their own
 * homepage. A dialog that let the date be left empty would put the boolean
 * straight back — so there is no "pin indefinitely", and the field defaults to
 * a month out rather than to nothing.
 *
 * ── NO NATIVE DIALOG ANYWHERE NEAR THIS ────────────────────────────────────
 *
 * Unpinning is a real removal and the obvious shape for it is a `confirm()`.
 * CLAUDE.md bans it outright — it renders in OS chrome that discards the
 * tenant's white-label branding, its buttons say OK and Cancel rather than
 * naming the action, and it cannot be translated. It is a second button in this
 * dialog instead, which names what it does.
 */
function PinDialog({
  row,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  row: api.InsightArticle;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (pinnedUntil: string | null) => void;
}) {
  const pinned = api.isPinned(row);
  const [day, setDay] = React.useState(() =>
    pinned && row.pinned_until
      ? String(row.pinned_until).slice(0, 10)
      : new Date(Date.now() + 86400e3 * 30).toISOString().slice(0, 10),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={pinned ? tr("Change how long this stays up") : tr("Pin to the home page")}
      description="Pinned announcements appear in the band under your hero, newest expiry first. At most five show at once."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(endOfDayIso(day));
        }}
      >
        <p className="text-sm text-muted-foreground">{row.title_fr}</p>
        <Field
          label={tr("Show it until")}
          required
          hint="It comes off the home page on its own after this date. It stays published at its own address."
        >
          <Input
            type="date"
            min={tomorrow()}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Not a confirm() — see the note above. */}
          {pinned ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onSubmit(null)}
            >
              {tr("Take it off the home page")}
            </Button>
          ) : (
            <span />
          )}
          <FormButtons
            busy={busy}
            disabled={busy || !day}
            onCancel={onClose}
            saveLabel={pinned ? tr("Update") : tr("Pin it")}
          />
        </div>
      </form>
    </Modal>
  );
}

/**
 * Creation asks for the headline and nothing else.
 *
 * The table has sixteen writable columns and the server requires one of them.
 * A new-article dialog demanding a slug, an excerpt and an SEO description is a
 * dialog somebody abandons — and every one of those fields can be set on the
 * article's own screen a moment later, which is where a writer will be anyway.
 */
function ArticleForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titleFr, setTitleFr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = await api.createInsight({ title_fr: titleFr.trim() });
      onSaved();
      onClose();
      // Straight into the editor. A writer who has just typed a headline wants
      // to write; sending them back to a list to find the row they created is
      // a step that exists only because the code was easier that way.
      nav(`/settings/website/articles/${row.insight_article_id}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("New article")}
      description="It starts as a draft. Nothing is served until you publish it."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label={tr("Headline (French)")}
          required
          hint="Required — French is what the public page falls back to when there is no translation."
        >
          <Input
            value={titleFr}
            onChange={(e) => setTitleFr(e.target.value)}
            placeholder="Ce que décide vraiment un Incoterm"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !titleFr.trim()}
          onCancel={onClose}
          saveLabel={tr("Create article")}
        />
      </form>
    </Modal>
  );
}

export default WebsiteInsightsPage;

/**
 * The AI-suggested OHADA posting, as the dictionary wizard shows it
 * (meeting 6, F3 / F7).
 *
 * WHAT IT SAYS, ALWAYS. Where the suggestion came from — a fresh web search,
 * the shared answer (no cost), the shared answer for a near-identical line, or
 * "Suggested without a web search" with the reason — and how sure it is
 * (high / medium / low). A low-confidence posting carries "Check this one"
 * until a person ticks that they checked it. Nothing here saves: the wizard
 * pre-fills from it and a person saves.
 *
 * GOOGLE'S TERMS, ON SCREEN. A grounded answer is shown with Google's Search
 * Suggestions exactly as provided (`search_suggestion_html`, Google's own HTML
 * and CSS, isolated in a sandboxed frame so it can neither restyle the page
 * nor run in it), and with the sources as Google returned them. Neither is
 * stored anywhere: a cached answer has no sources to show, says so, and offers
 * "Search again" for them.
 */
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill, type Tone } from "@/components/ui/pill";
import { dateFmt } from "@/lib/format";
import type { PostingSuggestion } from "@/lib/masterdata-api";

const CONFIDENCE: Record<string, { tone: Tone; label: string }> = {
  high: { tone: "ok", label: "High confidence" },
  medium: { tone: "warn", label: "Medium confidence" },
  low: { tone: "bad", label: "Low confidence" },
};

/** The one line that says where a suggestion came from. */
function sourceLine(s: PostingSuggestion): string {
  switch (s.source) {
    case "search":
      return `${tr("Suggested from a web search")}${s.model ? ` · ${s.model}` : ""}`;
    case "cache":
      return `${tr("From the shared answer")}${s.answered_at ? ` ${tr("of")} ${dateFmt(s.answered_at)}` : ""} · ${tr("no cost")}`;
    case "near_cache":
      return `${tr("From the shared answer for")} “${s.matched_label ?? ""}” · ${tr("no cost")}`;
    default:
      return tr("Suggested without a web search");
  }
}

export function PostingSuggestionPanel({
  suggestion,
  loading,
  error,
  applied,
  checked,
  onChecked,
  onApply,
  onSearchAgain,
  onMint,
}: {
  suggestion: PostingSuggestion | null;
  loading: boolean;
  error?: string | null;
  /** The wizard already pre-filled the posting from this suggestion. */
  applied: boolean;
  checked: boolean;
  onChecked: (v: boolean) => void;
  /** Offered when the suggestion is shown beside a posting it did not fill. */
  onApply?: () => void;
  onSearchAgain: () => void;
  /** An account the tenant's chart lacks: open the "create account" panel. */
  onMint?: (code: string, ruleIndex: number, side: "debit" | "credit") => void;
}) {
  if (loading && !suggestion) {
    return (
      <div
        className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        {tr("Looking up the SYSCOHADA posting for this line…")}
      </div>
    );
  }
  if (error && !suggestion) {
    return (
      <div
        className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        {tr("No suggestion this time: fill the posting by hand.")} {error}
      </div>
    );
  }
  if (!suggestion) return null;
  const conf = CONFIDENCE[suggestion.confidence] ?? CONFIDENCE.low;
  const mints = suggestion.rules.flatMap((r, i) =>
    (["debit", "credit"] as const)
      .filter((side) => r.mapping?.[side]?.how === "mint")
      .map((side) => ({ i, side, code: r.mapping![side].suggested })),
  );
  return (
    <div
      className="space-y-2 rounded-md border bg-muted/30 p-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">
          {tr("AI-suggested posting")}
        </span>
        <Pill tone={conf.tone}>{tr(conf.label)}</Pill>
        {suggestion.check_needed && !checked && (
          <Pill tone="bad">{tr("Check this one")}</Pill>
        )}
        <span className="micro">{sourceLine(suggestion)}</span>
        <div className="ml-auto flex gap-2">
          {onApply && !applied && (
            <Button type="button" size="sm" onClick={onApply}>
              {tr("Use this posting")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={loading}
            onClick={onSearchAgain}
          >
            {tr("Search again")}
          </Button>
        </div>
      </div>
      {suggestion.fallback_reason && (
        <p className="micro">
          {tr("Why")}: {suggestion.fallback_reason}.
        </p>
      )}
      <p className="text-xs text-foreground">{suggestion.rationale}</p>
      {mints.length > 0 && (
        <div className="space-y-1">
          {mints.map((m) => (
            <div
              key={`${m.i}-${m.side}`}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span>
                {m.code} {tr("is not in your chart of accounts.")}
              </span>
              {onMint && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onMint(m.code, m.i, m.side)}
                >
                  {tr("Create")} {m.code}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {suggestion.sources.length > 0 ? (
        <ul className="space-y-0.5 text-xs">
          {suggestion.sources.map((s, i) => (
            <li key={`${s.uri ?? s.title}-${i}`}>
              {s.uri ? (
                <a
                  href={s.uri}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary-ink underline"
                >
                  {s.title}
                </a>
              ) : (
                <span>{s.title}</span>
              )}
            </li>
          ))}
        </ul>
      ) : suggestion.source === "cache" ||
        suggestion.source === "near_cache" ? (
        <p className="micro">
          {tr(
            "Sources are shown with a live search: use Search again to see them.",
          )}
        </p>
      ) : null}
      {suggestion.search_suggestion_html && (
        <iframe
          title={tr("Google Search suggestions")}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={suggestion.search_suggestion_html}
          className="h-14 w-full rounded border-0"
        />
      )}
      {suggestion.check_needed && (
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onChecked(!!v)}
          label={
            <span className="text-xs">{tr("I checked this posting")}</span>
          }
        />
      )}
    </div>
  );
}

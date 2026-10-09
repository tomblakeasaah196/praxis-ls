/**
 * The public verification portal — what a stranger holding a printed document
 * sees when they scan its QR or type the code beneath it.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §5.4, §5.7.
 *
 * ── WHY IT LIVES IN THIS APP AND NOT IN THE ERP ────────────────────────────
 *
 * It used to be a route in `client/`, which meant it was served on the STAFF
 * workspace host. That put a tenant's internal ERP hostname on their customer's
 * invoice, and on a host whose root is a staff sign-in screen. Worse, on a
 * tenant who had brought their own domain the page was simply unreachable:
 * `src/server.js` serves this app at the root of a `surface='public'` host and
 * the ERP not at all, so `their-domain.com/verify` fell through to this app's
 * router and rendered a 404 — on exactly the domain they print on paper.
 *
 * The QR now resolves to the tenant's public site
 * (`services/signatures/verify-link.js`), which is this app, and the workspace
 * host 302s here for every document printed before that change.
 *
 * ── WHO THIS PAGE IS FOR ───────────────────────────────────────────────────
 *
 * Not a user. A customs officer at a border post, a supplier's accounts clerk,
 * a buyer's lawyer three years from now. They have no account, no training and
 * no reason to trust us, so the page answers in sentences, states the two
 * verdicts separately, and never shows an enum.
 *
 * ── THREE RULES IT KEEPS ───────────────────────────────────────────────────
 *
 * 1. THE SUMMARY IS THE DOCUMENT AS SIGNED. It comes from the API's `as_signed`,
 *    which the server renders from the payload frozen at signing time. This page
 *    must never fetch the live record to fill a gap: a March waybill scanned in
 *    September would then show September's figures to whoever holds March's
 *    paper.
 * 2. NOTHING IS RENDERED THAT THE SERVER DID NOT RESOLVE. No doc-type branching,
 *    no fallback that dumps whatever fields came back. An unregistered doc type
 *    shows the verdicts and the signer, and that is the correct amount.
 * 3. ONE ANSWER FOR UNKNOWN. The server returns the same 404 for a malformed
 *    code and one that never existed, and so does this page. Distinguishing them
 *    turns the portal into an oracle confirming which of 2^60 codes are real.
 *
 * ── WHY THERE IS NO IN-PAGE QR SCANNER ─────────────────────────────────────
 *
 * A phone's own camera app already scans the QR and opens this URL, so the only
 * person who reaches the manual form is someone the QR could not serve: a
 * photocopy, a fax, a dim warehouse, a creased invoice. An in-page camera fails
 * on that same degraded symbol, so it would add a dependency and a permission
 * prompt to this app's bundle in exchange for helping nobody. The code beneath
 * the QR is the fallback, and it is printed there precisely for this.
 *
 * ── LANGUAGE ───────────────────────────────────────────────────────────────
 *
 * FR by default, EN on `?lang=en` (§3.14). The site's own cascade reads `?lang=`
 * first too (`lib/i18n.ts`), so the chrome and the page agree whenever the URL
 * says so; where it does not, this page nudges the runtime language to its own
 * default WITHOUT persisting a preference. See `usePortalLang` below.
 */

import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { PublicApiError, publicGet } from "@/lib/api";
import { useBranding } from "@/app/branding";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
/* A LOCAL copy of the rule, held to the server's by `tests/unit/verify-code-
   parity.test.js` at the repo root. Not an `@praxis/shared` import: D-1 says
   this app does not depend on that package (public-web/eslint.config.js), and
   the parity test is the remedy that rule itself names. */
import {
  CODE_LENGTH,
  formatPartial,
  isValidCode,
  normaliseCode,
} from "@/lib/verify-code";
/** `site.verify.*`, bound to this page so the key prefix is written once. */
type Copy = (key: string) => string;
type Lang = "fr" | "en";

type Verdict = {
  key: string;
  state: "PASS" | "FAIL" | "UNKNOWN";
  label: string;
  message: string;
};

type SummaryField = { key: string; label: string; value: string };

type Payload = {
  status: "VALID" | "AMENDED" | "REVOKED";
  language: Lang;
  /**
   * The code was minted in the tenant's test environment, not live. Set from the
   * printed URL's `?e=sandbox`, baked in when the PDF was rendered; a live
   * document lacks it. The banner below tells the reader.
   */
  test_environment?: boolean;
  verdicts: Verdict[];
  signature: {
    verify_code: string;
    doc_type: string;
    content_hash_short: string;
    revoked_at: string | null;
    revoke_reason: string | null;
    card: {
      preset_code: string;
      label: string;
      blurb: string | null;
      tier: string | null;
      assurance_level: string;
      visual_mark: string;
    } | null;
    signed: {
      name: string;
      role: string | null;
      party: string;
      identity_source: string;
      identity_words: string;
      method: string;
      signing_window?: { opened_at: string | null; words: string } | null;
      reason: string | null;
      signed_at: string;
      ip: string;
      device: string;
    };
  };
  as_signed: {
    doc_type: string;
    title: string;
    fields: SummaryField[];
    detail: { label: string; value: string } | null;
  } | null;
  changes: { field: string; label: string; before: string | null; after: string | null }[];
  issuer: {
    legal_name: string;
    trading_name: string | null;
    rccm: string | null;
    niu: string | null;
    address: string | null;
  } | null;
};

/* ── tone tables ─────────────────────────────────────────────────────────── */

/**
 * Semantic tokens, never a raw palette colour: a `text-emerald-600` stays
 * emerald when the tenant's brand is teal, and this page is the tenant's face to
 * a stranger.
 */
const VERDICT_INK: Record<string, string> = {
  PASS: "text-ok",
  FAIL: "text-bad",
  UNKNOWN: "text-warn",
};

/**
 * A glyph AND a word, never a glyph alone. The message beside it carries the
 * verdict in prose, so a reader who cannot distinguish the marks — colour-blind,
 * or holding a monochrome printout of this page — loses nothing.
 */
const VERDICT_MARK: Record<string, string> = {
  PASS: "✓",
  FAIL: "✕",
  UNKNOWN: "?",
};

const NOTICE_TONE = {
  ok: "st-ok",
  warn: "st-warn",
  bad: "st-bad",
} as const;

/** Own-properties only — the guard a lookup table exposed to server data wants. */
function pick<T>(map: Record<string, T>, key: unknown, fallback: T): T {
  if (typeof key !== "string") return fallback;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

/**
 * Day-first, always, and never `toLocaleDateString()` with no locale.
 *
 * An undefined locale means "whatever this machine is set to", which is
 * month-first on a US workstation. This page states when a document was signed
 * and is read by people who will act on that date, so the one reading it must
 * not depend on where the reader bought their laptop. CLAUDE.md, second rule.
 */
function formatWhen(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(d);
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function Notice({
  tone,
  title,
  children,
}: {
  tone: keyof typeof NOTICE_TONE;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-[var(--radius)] border p-4 ${NOTICE_TONE[tone]}`}>
      <p className="font-semibold">{title}</p>
      {children ? <p className="mt-1 text-sm">{children}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-border/60 py-2 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * The two verdicts, on separate lines and never merged into one badge.
 *
 * A document can pass one and fail the other, and that pair is informative
 * rather than contradictory: "this is our file, and the record behind it has
 * moved on" is a real state a reader needs to be able to see.
 */
function Verdicts({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <div className="space-y-2">
      {verdicts.map((v) => (
        <div key={v.key} className="flex items-start gap-3 rounded-lg border border-border p-3">
          <span aria-hidden className={pick(VERDICT_INK, v.state, "text-muted-foreground")}>
            {pick(VERDICT_MARK, v.state, "?")}
          </span>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{v.label}</div>
            <p className="text-sm">{v.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The signature's preset card, read-only.
 *
 * The ERP's `SignatureCard` is a `<button>` that a sender or a signer picks
 * from. Nothing is selectable here, so this renders the same three facts as a
 * static block rather than shipping an interactive control that does nothing:
 * a disabled-looking button on a public page reads as something the visitor
 * failed to be allowed to press.
 *
 * `assurance_words` comes resolved from the server, which is where the tenant's
 * language lives. The ERP's own vocabulary map is English-only and must not be
 * reached for here.
 */
function PresetBlock({
  card,
  assuranceWords,
}: {
  card: NonNullable<Payload["signature"]["card"]>;
  assuranceWords: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold">{card.label}</span>
        {card.tier ? <Pill tone="mute">{`Tier ${card.tier}`}</Pill> : null}
      </span>
      {card.blurb ? <span className="text-xs text-muted-foreground">{card.blurb}</span> : null}
      <span className="text-xs text-muted-foreground">{assuranceWords}</span>
    </div>
  );
}

/**
 * The anti-fraud explainer (§5.4). Written for an auditor, not an engineer.
 *
 * A `<details>` rather than a modal: this app has no dialog primitive, and a
 * disclosure is the better control anyway. It needs no focus trap, no scroll
 * lock and no escape handler to get right, it is readable with JavaScript
 * broken, and it prints — which matters on a page somebody screenshots or files.
 */
function HowDisclosure({ c }: { c: Copy }) {
  return (
    <details className="group rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium underline underline-offset-2">
        {c("howLink")}
      </summary>
      <div className="mt-3 space-y-4">
        <h2 className="text-sm font-semibold">{c("howTitle")}</h2>
        {[
          [c("identityH"), c("identityB")],
          [c("integrityH"), c("integrityB")],
          [c("traceH"), c("traceB")],
        ].map(([h, b]) => (
          <section key={h}>
            <h3 className="text-sm font-semibold">{h}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{b}</p>
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * Manual entry — the `/verify` route, and where a 404 lands you.
 *
 * ── WHAT THIS FIELD ACCEPTS, AND WHY IT IS THAT NARROW ─────────────────────
 *
 * Exactly one thing: the twelve-character code printed beneath the QR. Not an
 * invoice number, not a shipment reference, not an internal id, not a hash
 * prefix. `lib/verify-code.ts` is where that rule lives and why.
 *
 * Submit stays disabled until the shape is valid. That is not politeness about
 * typos: the portal's limiter is 60 lookups per IP per 15 minutes and is the
 * SOLE defence against enumerating a plaintext code, an office behind one NAT
 * shares that ceiling, and a round trip spent on eleven characters is one the
 * next colleague does not get.
 *
 * The value is reformatted as it is typed, so the field and the paper look
 * alike while somebody copies between them. Pasting the whole URL, or the code
 * with its printed hyphens, both land correctly.
 */
function CodeEntry({
  c,
  initial,
  onSubmit,
  busy,
}: {
  c: Copy;
  initial: string;
  onSubmit: (code: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = React.useState(() => formatPartial(initial));
  const normalised = normaliseCode(value);
  const ready = isValidCode(normalised);
  return (
    <Card padded as="section">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit(normalised);
        }}
      >
        <h2 className="text-lg font-semibold">{c("enterTitle")}</h2>
        <p className="text-sm text-muted-foreground">{c("enterLead")}</p>
        <Input
          id="verify-code"
          label={c("codeLabel")}
          value={value}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          /* The format is a placeholder, not a sentence under the field: a
             worked example of the thing being asked for teaches the shape in
             the place the shape is needed. */
          placeholder="A4B7-K92M-XQ1P"
          /* 14 = twelve characters plus the two printed separators. The cap is
             on the FORMATTED value, and `formatPartial` has already dropped
             anything past twelve, so a paste of a whole URL cannot overflow it. */
          maxLength={CODE_LENGTH + 2}
          onChange={(e) => setValue(formatPartial(e.target.value))}
          className="font-mono uppercase"
        />
        <Button type="submit" loading={busy} disabled={!ready}>
          {c("submit")}
        </Button>
      </form>
    </Card>
  );
}

/**
 * The language this page reads in, and the chrome around it.
 *
 * `?lang=` wins, because the reader is holding a URL somebody printed for them.
 * Absent that it is FR, which is this page's own default and not the site's:
 * the site defaults to EN for a visitor with no stored preference, and the
 * counterparty reading a Cameroonian freight document is more often francophone
 * than not (§3.14).
 *
 * ⚠ `i18n.changeLanguage`, NEVER `setLang`. `setLang` writes the choice to
 *   `localStorage` under the key the whole site reads, so arriving at a verify
 *   link would silently re-language the tenant's marketing site for that
 *   visitor on every later visit. This page is a one-off errand for a stranger;
 *   it may set the language for the session it is in and must not leave a
 *   preference behind it.
 */
function usePortalLang(): Lang {
  const [query] = useSearchParams();
  const lang: Lang = query.get("lang") === "en" ? "en" : "fr";
  React.useEffect(() => {
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
  }, [lang]);
  return lang;
}

/* ── the page ────────────────────────────────────────────────────────────── */

export function VerifyPage() {
  const { code: routeCode } = useParams();
  const [query, setQuery] = useSearchParams();
  const lang = usePortalLang();
  /**
   * The printed URL from a sandbox-signed document carries `?e=sandbox`. A
   * primitive kept in a variable rather than read off `query` inside the fetch
   * effect, so the deps array can name it and the effect re-fires exactly when
   * it actually changes.
   */
  const envParam = query.get("e") === "sandbox" ? "sandbox" : null;
  const { t } = useTranslation();
  const c: Copy = (key) => t(`site.verify.${key}`);

  const [code, setCode] = React.useState(routeCode || "");
  const [data, setData] = React.useState<Payload | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { branding } = useBranding();

  useDocumentMeta({ title: `${c("title")} · ${branding.name || ""}`.trim(), description: c("lead") });

  React.useEffect(() => {
    setCode(routeCode || "");
  }, [routeCode]);

  React.useEffect(() => {
    if (!code) {
      setData(null);
      setMissing(false);
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    setMissing(false);
    publicGet<Payload>(`/v/${encodeURIComponent(code)}`, {
      signal: ac.signal,
      query: {
        lang,
        /* The QR lands on /v/:code; a typed code arrives through the form. The
           distinction is worth logging: a document checked at a border post and
           one read down a phone line are different stories. */
        via: routeCode ? "QR" : "CODE",
        /* Forward the printed URL's env so the read pins to sandbox and the code
           resolves; a live URL has no `e` and reads live. */
        ...(envParam === "sandbox" ? { e: "sandbox" } : {}),
      },
    })
      .then((r) => setData(r))
      .catch((e: unknown) => {
        if (e instanceof PublicApiError && e.status === 0) return; // aborted or offline
        /* One answer for "no such verification". The server does not distinguish
           a malformed code from one that never existed, and neither does this
           page — otherwise the portal becomes an oracle confirming which of
           2^60 codes are real. A rate-limit answer lands here too, deliberately:
           saying "you have made too many attempts" to someone probing the space
           is itself a signal, and the honest visitor who hits it is told to
           check the code and contact the issuer, which is the right next step
           either way. */
        setData(null);
        setMissing(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setBusy(false);
      });
    return () => ac.abort();
  }, [code, lang, routeCode, envParam]);

  const toggleLang = () => {
    const next = new URLSearchParams(query);
    next.set("lang", lang === "fr" ? "en" : "fr");
    setQuery(next, { replace: true });
  };

  const headline =
    data?.status === "REVOKED"
      ? { tone: "bad" as const, title: c("revokedTitle"), body: c("revokedBody") }
      : data?.status === "AMENDED"
        ? { tone: "bad" as const, title: c("amendedTitle"), body: c("amendedBody") }
        : data
          ? { tone: "ok" as const, title: c("validTitle"), body: "" }
          : null;

  return (
    <PageShell label={c("title")}>
      <PageContainer size="reading">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <h1 className="text-2xl font-bold md:text-3xl">{c("title")}</h1>
          <Button size="sm" variant="ghost" onClick={toggleLang}>
            {c("langSwitch")}
          </Button>
        </header>

        {busy && !data && (
          <div className="mt-6 space-y-3" role="status" aria-label={c("checking")}>
            <Skeleton className="h-20" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        )}

        {!code && !busy && (
          <div className="mt-6">
            <CodeEntry c={c} initial="" onSubmit={setCode} busy={busy} />
          </div>
        )}

        {missing && !busy && (
          <div className="mt-6 space-y-4">
            <Notice tone="warn" title={c("notFoundTitle")}>
              {c("notFoundBody")}
            </Notice>
            <CodeEntry c={c} initial={code} onSubmit={setCode} busy={busy} />
          </div>
        )}

        {data && headline && (
          <div className="mt-6 space-y-6">
            {/* Test-environment banner (§5.4). Above the primary verdict because
                it re-frames every claim below it: the seal is authentic, the
                document is a test one. A reader who scrolls past it and treats
                the sheet as production has been misled by our own page. */}
            {data.test_environment && (
              <Notice tone="warn" title={c("testEnvTitle")}>
                {c("testEnvBody")}
              </Notice>
            )}

            <Notice tone={headline.tone} title={headline.title}>
              {headline.body || c("lead")}
            </Notice>

            <Verdicts verdicts={data.verdicts} />

            {data.status === "REVOKED" && data.signature.revoke_reason && (
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {c("revokedReasonLabel")}
                </div>
                <p className="mt-1 text-sm">{data.signature.revoke_reason}</p>
              </div>
            )}

            {data.changes.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold">{c("changed")}</h2>
                <dl className="mt-2">
                  {data.changes.map((ch) => (
                    <Row
                      key={ch.field}
                      label={ch.label}
                      value={
                        ch.before !== null && ch.after !== null ? (
                          <span className="font-mono text-xs">
                            {ch.before} → {ch.after}
                          </span>
                        ) : (
                          <Pill tone="warn">{lang === "en" ? "Changed" : "Modifié"}</Pill>
                        )
                      }
                    />
                  ))}
                </dl>
              </section>
            )}

            <section>
              <h2 className="text-lg font-semibold">{c("signatureH")}</h2>
              <dl className="mt-2">
                <Row
                  label={c("signedBy")}
                  value={
                    <>
                      {data.signature.signed.name}
                      {data.signature.signed.role ? ` · ${data.signature.signed.role}` : ""}
                    </>
                  }
                />
                <Row
                  label={c("onBehalf")}
                  value={data.signature.signed.party === "INTERNAL" ? c("internal") : c("external")}
                />
                <Row label={c("method")} value={data.signature.signed.method} />
                {data.signature.signed.signing_window && (
                  <Row
                    label={c("signingWindow")}
                    value={
                      data.signature.signed.signing_window.opened_at
                        ? `${data.signature.signed.signing_window.words} (${formatWhen(
                            data.signature.signed.signing_window.opened_at,
                            lang,
                          )})`
                        : data.signature.signed.signing_window.words
                    }
                  />
                )}
                {data.signature.signed.reason && (
                  <Row label={c("reason")} value={data.signature.signed.reason} />
                )}
                <Row label={c("signedAt")} value={formatWhen(data.signature.signed.signed_at, lang)} />
                {/* §3.13 — masked server-side by services/signatures/mask.js.
                    This page never receives a full address, so it cannot leak one. */}
                <Row label={c("network")} value={data.signature.signed.ip || "—"} />
                <Row label={c("device")} value={data.signature.signed.device} />
                <Row
                  label={c("code")}
                  value={<span className="font-mono">{data.signature.verify_code}</span>}
                />
                <Row
                  label={c("contentHash")}
                  value={
                    <span className="font-mono text-xs">{data.signature.content_hash_short}</span>
                  }
                />
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                {data.signature.signed.identity_words}
              </p>
            </section>

            {data.signature.card && (
              <PresetBlock
                card={data.signature.card}
                assuranceWords={data.signature.signed.method}
              />
            )}

            <section>
              <h2 className="text-lg font-semibold">
                {data.as_signed ? data.as_signed.title : c("asSigned")}
              </h2>
              {data.as_signed ? (
                <>
                  <dl className="mt-2">
                    {data.as_signed.fields.map((f) => (
                      <Row key={f.key} label={f.label} value={f.value} />
                    ))}
                  </dl>
                  {data.as_signed.detail && (
                    <div className="mt-3 rounded-lg border border-border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {data.as_signed.detail.label}
                      </div>
                      <p className="mt-1 text-sm">{data.as_signed.detail.value}</p>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{c("asSignedNote")}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{c("noSummary")}</p>
              )}
            </section>

            {data.issuer && (
              <section>
                <h2 className="text-lg font-semibold">{c("issuer")}</h2>
                <p className="mt-1 text-sm">
                  {data.issuer.legal_name}
                  {data.issuer.rccm ? ` · RCCM ${data.issuer.rccm}` : ""}
                  {data.issuer.niu ? ` · NIU ${data.issuer.niu}` : ""}
                </p>
                {data.issuer.address && (
                  <p className="text-sm text-muted-foreground">{data.issuer.address}</p>
                )}
              </section>
            )}
          </div>
        )}

        <div className="mt-10 space-y-3 border-t border-border pt-4">
          <HowDisclosure c={c} />
          {/* Q13 — one line, always, whether or not a document resolved. */}
          <p className="text-xs text-muted-foreground">{c("privacy")}</p>
        </div>
      </PageContainer>
    </PageShell>
  );
}

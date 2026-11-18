import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
/* Side-effect import: registers `site.quotation.*` as this chunk is evaluated,
   before anything here renders. */
import "./quotation-i18n";
import {
  getQuotation,
  quotationPdfUrl,
  startAccept,
  resendCode,
  completeAccept,
  confirmAccept,
  declineQuotation,
  type PublicQuotation,
  type QuotationLang,
  type QuotationSignature,
  type SignCard,
  type SigningStart,
} from "@/lib/quotation-api";
import { PublicApiError, messageFor } from "@/lib/api";
import { useBranding } from "@/app/branding";
import { getLang, setLang, tStatic } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BrandGlyph, DownloadIcon, DocumentIcon, ShieldIcon, CheckIcon, CloseIcon } from "@/components/ui/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState, EmptyState } from "@/components/state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentMeta } from "@/lib/use-document-meta";
/* The two pieces the portal signs with, reused rather than copied: the six
   boxes for the emailed code and the drawn-signature pad. They take the
   page's own words and the site's look as props, so the portal's dictionary
   and stylesheet stay in the portal's chunk. */
import { CodeInput } from "@/features/portal/ui/code-input";
import { SignaturePad } from "@/features/portal/ui/signature-pad";

/**
 * `/q/:token`: a quotation sent to one recipient, the public link of the lean
 * revamp (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4 "The link", §3.8). It
 * replaces the proposal page; `/proposal/:token` and `/proposals/:token`
 * redirect here, and an old proposal token opens the quotation it became.
 *
 * ── THE DOCUMENT IS THE SERVER'S ONE RENDER ────────────────────────────────
 *
 * The server sends the output chosen at send (Full Proposal or Commercial
 * Extract) as the same HTML the PDF prints. This page formats nothing inside
 * it and shows it in a sandboxed frame with no scripts, the way the staff
 * app's quotation preview does: a reader who downloads the PDF and a reader
 * who scrolls the page are reading one document. `allow-same-origin` is there
 * only so the frame can be sized to its content; without `allow-scripts`
 * nothing in the document runs.
 *
 * ── TWO ANSWERS, ONLY WHILE IT IS OPEN ─────────────────────────────────────
 *
 * Accept: a name and a role, then the code emailed to the address the
 * quotation was sent to, then a stamp or a drawn mark (the signature
 * programme). Where the tenant offers no e-signature, a named, confirmed
 * accept stands in, and is never called a signature. Decline: a reason from
 * the list and a line. Anything but SENT and in date reads as what it is,
 * with no buttons.
 *
 * ── THE TOKEN IS THE CREDENTIAL ────────────────────────────────────────────
 *
 * Unknown, revoked, expired-link and draft are one 404, and every 404 is the
 * same calm page: ask your contact for an updated link. No sign-in prompt.
 */
export function QuotationPage() {
  const { t } = useTranslation();
  const { token: raw = "" } = useParams();
  const token = decodeURIComponent(raw);
  const [params, setParams] = useSearchParams();
  const { branding } = useBranding();

  // `?lang=` is the reader asking for the other language of THIS document;
  // without it, the site's. The server decides what it can produce.
  const asked = params.get("lang");
  const requested: QuotationLang = String(asked || getLang()).toUpperCase() === "FR" ? "FR" : "EN";
  React.useEffect(() => {
    if (asked) setLang(requested === "FR" ? "fr" : "en");
  }, [asked, requested]);

  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "found"; q: PublicQuotation } | { kind: "gone" } | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let alive = true;
    getQuotation(token, requested)
      .then((data) => {
        if (!alive) return;
        setState(data && typeof data.html === "string" ? { kind: "found", q: data } : { kind: "gone" });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound) setState({ kind: "gone" });
        else setState({ kind: "error", message: messageFor(e, tStatic("errors.loadFailed")) });
      });
    return () => {
      alive = false;
    };
  }, [token, requested, nonce]);

  const q = state.kind === "found" ? state.q : null;
  const lang = q ? q.language : requested;
  const languages = q ? q.languages.filter((l) => l === "EN" || l === "FR") : [];
  useDocumentMeta({
    title: q ? [q.quotation.title, q.quotation.doc_number].filter(Boolean).join(" · ") || t("site.quotation.title") : t("site.quotation.title"),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="no-print border-b border-border">
        <div className="wrap flex items-center justify-between gap-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.name || ""} className="h-7 w-auto max-w-40 object-contain object-left" />
            ) : (
              <>
                <BrandGlyph name={branding.name || "Praxis"} size={26} />
                <span className="truncate font-display text-sm font-semibold tracking-tight">{branding.name || "Praxis"}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {languages.length > 1 ? (
              <div
                role="group"
                aria-label={t("site.quotation.langSwitch")}
                className="flex items-center gap-1 rounded-[calc(var(--radius)-2px)] border border-border p-0.5"
              >
                {languages.map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => {
                      // The URL is the state: a forwarded link opens in the
                      // language the sender and the reader agreed on.
                      const next = new URLSearchParams(params);
                      next.set("lang", l);
                      setParams(next);
                      setLang(l === "FR" ? "fr" : "en");
                    }}
                    className="h-8 rounded-[calc(var(--radius)-4px)] px-2.5 text-xs font-semibold data-[on=true]:bg-accent"
                    data-on={lang === l}
                  >
                    {l}
                  </button>
                ))}
              </div>
            ) : null}
            {q ? (
              <ButtonLink
                href={quotationPdfUrl(token, q.language)}
                size="sm"
                aria-label={t("site.quotation.download")}
                className="inline-flex items-center gap-2 whitespace-nowrap"
              >
                <DownloadIcon size={15} />
                {/* "Télécharger le PDF" wraps beside the logo on a phone. */}
                <span className="sm:hidden" aria-hidden="true">PDF</span>
                <span className="hidden sm:inline" aria-hidden="true">{t("site.quotation.download")}</span>
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </header>

      <main className="wrap py-8 md:py-12">
        <div className="mx-auto max-w-4xl">
          {state.kind === "loading" ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-96" />
            </div>
          ) : state.kind === "error" ? (
            <ErrorState message={state.message} />
          ) : !q ? (
            <Card padded>
              <EmptyState title={t("site.quotation.unavailable")} hint={t("site.quotation.unavailableHint")} icon={<DocumentIcon size={22} />} />
            </Card>
          ) : (
            <QuotationView q={q} token={token} onAnswered={reload} />
          )}
        </div>
      </main>
    </div>
  );
}

const TONE: Record<string, Tone> = { SENT: "blue", ACCEPTED: "ok", CONVERTED: "ok", REJECTED: "mute", EXPIRED: "mute" };

function QuotationView({ q, token, onAnswered }: { q: PublicQuotation; token: string; onAnswered: () => void }) {
  const { t } = useTranslation();
  const d = q.quotation;
  const [said, setSaid] = React.useState<string | null>(null);
  const answered = (words: string) => {
    setSaid(words);
    onAnswered();
  };

  return (
    <article className="grid gap-6">
      <header className="grid gap-2">
        {d.doc_number ? <p className="eyebrow">{d.doc_number}</p> : null}
        <h1 className="section-title text-balance">{d.title || d.doc_number || t("site.quotation.title")}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Pill tone={TONE[d.status] || "mute"}>
            <>{t(`site.quotation.status.${d.status in TONE ? d.status : "SENT"}`)}</>
          </Pill>
          {d.status === "SENT" && d.valid_until ? (
            <span className="text-sm text-muted-foreground">{t("site.quotation.validUntil", { date: dateFmt(d.valid_until) })}</span>
          ) : null}
          {d.version > 1 ? <span className="text-sm text-muted-foreground">{t("site.quotation.version", { n: d.version })}</span> : null}
        </div>
      </header>

      {said ? (
        <p role="status" className="rounded-[var(--radius)] border border-border bg-accent px-4 py-3 text-sm font-medium">
          {said}
        </p>
      ) : null}
      {q.signature ? <SignedCard sig={q.signature} /> : null}
      {d.status === "REJECTED" && d.decline_reason ? (
        <p className="text-sm text-muted-foreground">{d.decline_reason}</p>
      ) : null}

      <DocumentFrame html={q.html} title={t("site.quotation.document")} />

      {q.open ? (
        <Answer
          q={q}
          token={token}
          onAccepted={() => answered(t("site.quotation.accepted"))}
          onDeclined={() => answered(t("site.quotation.declined"))}
          onStale={onAnswered}
        />
      ) : null}
    </article>
  );
}

/** The server's render, in a frame that runs nothing, sized to its content. */
function DocumentFrame({ html, title }: { html: string; title: string }) {
  const ref = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  const fit = () => {
    try {
      const doc = ref.current?.contentDocument;
      const h = doc ? Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0) : 0;
      if (h > 0) setHeight(h + 16);
    } catch {
      /* @silent:fallback a frame we cannot measure keeps its fixed height */
    }
  };
  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={fit}
      className={cn("w-full rounded-[var(--radius)] border border-border bg-white", height ? null : "h-[80vh]")}
      style={height ? { height } : undefined}
    />
  );
}

/** "Signed by Marie Nguema, Finance · 18 Nov 2026", and the code that verifies it. */
function SignedCard({ sig }: { sig: QuotationSignature }) {
  const { t } = useTranslation();
  const code = sig.verify_code ? sig.verify_code.replace(/^(.{4})(.{4})$/, "$1-$2") : null;
  return (
    <Card padded className="flex items-start gap-3">
      <ShieldIcon size={20} className="mt-0.5 shrink-0 text-primary-ink" />
      <div className="min-w-0">
        <p className="font-semibold">{t("site.quotation.signedBy", { name: sig.signer_name })}</p>
        <p className="text-sm text-muted-foreground">{[sig.signer_role, dateFmt(sig.signed_at)].filter(Boolean).join(" · ")}</p>
        {code ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("site.quotation.verify")} <span className="font-mono font-semibold text-foreground">{code}</span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** A failed answer, in the page's words: a code problem, an answer that came first, or the generic one. */
function useAnswerError() {
  const { t } = useTranslation();
  return React.useCallback(
    (e: unknown): { message: string; codeProblem: boolean; stale: boolean } => {
      const code = e instanceof PublicApiError ? e.code : "";
      if (/^OTP_/.test(code)) {
        const key = `site.quotation.otp.${code}`;
        const words = t(key);
        return { message: words === key ? t("site.quotation.otp.OTP_INVALID") : words, codeProblem: true, stale: false };
      }
      if (code === "QUOTATION_ANSWERED") return { message: t("site.quotation.answeredAlready"), codeProblem: false, stale: true };
      if (code === "QUOTATION_EXPIRED" || (e instanceof PublicApiError && e.isNotFound))
        return { message: t("site.quotation.expired"), codeProblem: false, stale: true };
      return { message: messageFor(e, t("site.quotation.failed")), codeProblem: false, stale: false };
    },
    [t],
  );
}

function Answer({
  q,
  token,
  onAccepted,
  onDeclined,
  onStale,
}: {
  q: PublicQuotation;
  token: string;
  onAccepted: () => void;
  onDeclined: () => void;
  onStale: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<"accept" | "decline" | null>(null);
  return (
    <Card padded className="no-print grid gap-4">
      <h2 className="text-title font-semibold tracking-tight">{t("site.quotation.answer")}</h2>
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("accept")}>
            <CheckIcon size={18} />
            {t("site.quotation.accept")}
          </Button>
          <Button variant="outline" onClick={() => setMode("decline")}>
            {t("site.quotation.decline")}
          </Button>
        </div>
      ) : mode === "accept" ? (
        <AcceptFlow q={q} token={token} onCancel={() => setMode(null)} onDone={onAccepted} onStale={onStale} />
      ) : (
        <DeclineFlow q={q} token={token} onCancel={() => setMode(null)} onDone={onDeclined} onStale={onStale} />
      )}
    </Card>
  );
}

/**
 * Accept. Who first (a name, a role); then, where the tenant offers an
 * e-signature, the emailed code and the mark; otherwise the named confirm.
 */
function AcceptFlow({
  q,
  token,
  onCancel,
  onDone,
  onStale,
}: {
  q: PublicQuotation;
  token: string;
  onCancel: () => void;
  onDone: () => void;
  onStale: () => void;
}) {
  const { t } = useTranslation();
  const explain = useAnswerError();
  const lang = q.language;
  const signs = q.signing.available;
  const [step, setStep] = React.useState<"who" | "code" | "mark">("who");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [start, setStart] = React.useState<SigningStart | null>(null);
  const [code, setCode] = React.useState("");
  const offer: SignCard[] = start && start.cards.length ? start.cards : q.signing.cards;
  const [card, setCard] = React.useState<SignCard["preset_code"]>(offer[0]?.preset_code || "STAMP");
  const [mark, setMark] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const who = { full_name: name.trim(), role: role.trim() || null };
  const nameOk = who.full_name.length >= 2;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      const why = explain(e);
      setError(why.message);
      if (why.codeProblem) {
        setCode("");
        setStep("code");
      }
      if (why.stale) onStale();
    } finally {
      setBusy(false);
    }
  }

  const begin = () =>
    run(async () => {
      if (!signs) {
        await confirmAccept(token, lang, who);
        onDone();
        return;
      }
      const s = await startAccept(token, lang, who);
      setStart(s);
      const first = (s.cards.length ? s.cards : q.signing.cards)[0];
      if (first) setCard(first.preset_code);
      setStep("code");
    });

  const resend = () =>
    run(async () => {
      await resendCode(token, lang);
      setNote(t("site.quotation.resent"));
    });

  const sign = () =>
    run(async () => {
      await completeAccept(token, lang, {
        code,
        preset_code: card,
        ...who,
        ...(card === "DRAWN" && mark ? { mark_image_b64: mark } : {}),
      });
      onDone();
    });

  return (
    <div className="grid gap-4">
      {step === "who" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("site.quotation.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" required />
            <Input
              label={t("site.quotation.role")}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              maxLength={120}
              placeholder={t("site.quotation.rolePlaceholder")}
              autoComplete="organization-title"
            />
          </div>
          {!signs ? <p className="text-sm text-muted-foreground">{t("site.quotation.confirmBody")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void begin()} disabled={!nameOk || busy} loading={busy}>
              {signs ? t("site.quotation.sendCode") : t("site.quotation.confirm")}
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t("site.quotation.cancel")}
            </Button>
          </div>
        </>
      ) : step === "code" ? (
        <>
          {start ? <p className="text-sm">{t("site.quotation.codeSent", { email: start.signer.email_masked })}</p> : null}
          <CodeInput
            value={code}
            onChange={setCode}
            disabled={busy}
            label={t("site.quotation.codeLabel")}
            digitLabel={(n) => t("site.quotation.digit", { n })}
            className="grid max-w-sm grid-cols-6 gap-2"
            inputClassName="field h-14 w-full px-0 text-center font-mono text-2xl font-semibold"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStep("mark")} disabled={code.length !== 6 || busy}>
              {t("site.quotation.next")}
            </Button>
            <Button variant="ghost" onClick={() => void resend()} disabled={busy}>
              {t("site.quotation.resend")}
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t("site.quotation.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {offer.length > 1 ? (
            <div role="group" aria-label={t("site.quotation.how")} className="flex flex-wrap gap-2">
              {offer.map((c) => (
                <Button key={c.preset_code} variant={card === c.preset_code ? "default" : "outline"} size="sm" aria-pressed={card === c.preset_code} onClick={() => setCard(c.preset_code)}>
                  {t(`site.quotation.card.${c.preset_code}`)}
                </Button>
              ))}
            </div>
          ) : null}
          {card === "DRAWN" ? (
            <div>
              <p className="field-label">{t("site.quotation.draw")}</p>
              <SignaturePad
                onChange={setMark}
                label={t("site.quotation.draw")}
                clearLabel={t("site.quotation.clear")}
                padClassName="relative max-w-lg overflow-hidden rounded-[var(--radius)] border border-dashed border-border bg-white"
                lineClassName="pointer-events-none absolute inset-x-[18px] bottom-[34px] h-px bg-border"
                clearClassName="mt-1 text-sm font-semibold text-primary-ink underline-offset-2 hover:underline"
              />
            </div>
          ) : (
            <div className="max-w-sm rounded-[var(--radius)] border border-border px-4 py-3" aria-hidden="true">
              <span className="block font-semibold">{who.full_name}</span>
              {who.role ? <span className="block text-sm text-muted-foreground">{who.role}</span> : null}
              <span className="mt-1 block text-xs text-muted-foreground">{dateFmt(new Date())}</span>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t("site.quotation.agree")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void sign()} disabled={busy || (card === "DRAWN" && !mark)} loading={busy}>
              <CheckIcon size={18} />
              {t("site.quotation.sign")}
            </Button>
            <Button variant="ghost" onClick={() => setStep("code")} disabled={busy}>
              {t("site.quotation.back")}
            </Button>
          </div>
        </>
      )}
      {note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Decline: a reason from the list, and a line if they want. */
function DeclineFlow({
  q,
  token,
  onCancel,
  onDone,
  onStale,
}: {
  q: PublicQuotation;
  token: string;
  onCancel: () => void;
  onDone: () => void;
  onStale: () => void;
}) {
  const { t } = useTranslation();
  const explain = useAnswerError();
  const [reason, setReason] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await declineQuotation(token, q.language, { reason_code: reason, note: note.trim() || null });
      onDone();
    } catch (e) {
      const why = explain(e);
      setError(why.message);
      if (why.stale) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="field-label">{t("site.quotation.declineTitle")}</legend>
        {q.decline_reasons.map((r) => (
          <label key={r.reason_code} className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input type="radio" name="decline-reason" value={r.reason_code} checked={reason === r.reason_code} onChange={() => setReason(r.reason_code)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <Textarea label={t("site.quotation.declineNote")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={400} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void send()} disabled={!reason || busy} loading={busy}>
          <CloseIcon size={18} />
          {t("site.quotation.declineSend")}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t("site.quotation.cancel")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

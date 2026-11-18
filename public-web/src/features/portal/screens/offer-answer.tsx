/**
 * Answering an offer: the sheets behind Accept and Decline, and the card that
 * says who signed. Every offer is a quotation since the lean revamp (§3.8),
 * and quotation.tsx is the one page that uses them; they live apart from it so
 * the page reads as the document and these as the two answers.
 *
 *   · DECLINE, with a reason from a short list (sales reads one vocabulary
 *     wherever a client said no) and a line of their own if they want;
 *   · ACCEPT AND SIGN: a code to the email on file, then a stamp with their
 *     name or a signature drawn with a finger. That is an e-signature the
 *     tenant's verification portal can answer for (the signature programme,
 *     doc/SIGNATURE_ENGINEERING_GUIDE.md), not a click that "counts as" one.
 *
 * The public link `/q/<token>` answers the same offer through the same two
 * pieces underneath (ui/code-input.tsx, ui/signature-pad.tsx).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { OfferSignature, SigningStart, SignCard, DeclineReason } from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { Sheet, IconDisc, TextField, TextArea, useToast, errorText, Busy, InfoButton, StepDots } from "../ui/kit";
import { CheckIcon, CloseIcon, ShieldIcon, MailIcon, RefreshIcon } from "../ui/icons";
import { CodeInput } from "../ui/code-input";
import { SignaturePad } from "../ui/signature-pad";

/**
 * How an offer is answered — the four calls behind the sign and decline
 * sheets. The sheets take them as a value, so a test or a second screen can
 * point them elsewhere without the flow drifting.
 */
export type OfferAnswerApi = {
  signStart: (id: string, lang: string) => Promise<SigningStart>;
  signResend: (id: string, lang: string) => Promise<{ otp: SigningStart["otp"] }>;
  signComplete: (
    id: string,
    lang: string,
    body: { code: string; preset_code: SignCard["preset_code"]; full_name?: string; party_role?: string; mark_image_b64?: string },
  ) => Promise<unknown>;
  decline: (id: string, reasonCode: string, note?: string) => Promise<unknown>;
};

/** "Signed by Marie Nguema, Finance · 28/09/2026", and the code that verifies it. */
export function SignedCard({ sig }: { sig: OfferSignature }) {
  const { t } = useTranslation();
  const code = sig.verify_code ? sig.verify_code.replace(/^(.{4})(.{4})$/, "$1-$2") : null;
  return (
    <div className="mt-5 flex items-start gap-3 rounded-[18px] border border-[var(--pt-line)] p-4">
      <IconDisc tone="ok" size={40}>
        <ShieldIcon size={20} />
      </IconDisc>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-foreground">{t("portal.answer.sign.signedBy", { name: sig.signer_name })}</p>
        <p className="truncate text-sm text-muted-foreground">{[sig.signer_role, dateFmt(sig.signed_at)].filter(Boolean).join(" · ")}</p>
        {code ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <span>{t("portal.answer.sign.verify")}</span>
            <span className="pt-mono font-semibold text-foreground">{code}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ── accept and sign ─────────────────────────────────────────────────────── */

/**
 * Two steps. The code first — sent the moment the sheet opens, to the email
 * on file, and shown masked — then the mark: a stamp with the name and role
 * the signer types, or a signature drawn with a finger. One request signs and
 * accepts; a wrong code comes back to step one with the reason.
 */
export function SignSheet({
  open,
  api,
  id,
  cards,
  title,
  agree,
  onClose,
  onDone,
}: {
  open: boolean;
  api: OfferAnswerApi;
  id: string;
  cards: SignCard[];
  title: string;
  /** What signing agrees to, in the document's own words. */
  agree: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const portal = usePortal();
  const lang = getLang();
  const [step, setStep] = React.useState(0);
  const [start, setStart] = React.useState<SigningStart | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [card, setCard] = React.useState<SignCard["preset_code"]>("STAMP");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [mark, setMark] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const begin = React.useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const s = await api.signStart(id, lang);
      setStart(s);
      const first = (s.cards.length ? s.cards : cards)[0];
      if (first) setCard(first.preset_code);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }, [api, id, lang, cards]);

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    setCode("");
    setMark(null);
    setError(null);
    setName(portal.me.portal_user.full_name || "");
    setRole("");
    void begin();
  }, [open, begin, portal.me.portal_user.full_name]);

  async function resend() {
    setError(null);
    try {
      const r = await api.signResend(id, lang);
      setStart((s) => (s ? { ...s, otp: r.otp } : s));
      toast(t("portal.answer.sign.resent"));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      await api.signComplete(id, lang, {
        code,
        preset_code: card,
        full_name: name.trim() || undefined,
        party_role: role.trim() || undefined,
        ...(card === "DRAWN" && mark ? { mark_image_b64: mark } : {}),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
      // A code problem is fixed on the code step.
      const c = (e as { code?: string }).code || "";
      if (/^OTP_/.test(c)) {
        setCode("");
        setStep(0);
      }
    } finally {
      setBusy(false);
    }
  }

  const offer = start?.cards.length ? start.cards : cards;
  const ready = step === 0 ? code.length === 6 && !!start : !!name.trim() && (card !== "DRAWN" || !!mark);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      title={step === 0 ? t("portal.answer.sign.step1") : t("portal.answer.sign.step2")}
      footer={
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setStep(0)} disabled={busy}>
              {t("portal.common.back")}
            </button>
          ) : null}
          <button type="button" className="pt-btn pt-btn-primary flex-1" disabled={!ready || busy || starting} onClick={() => (step === 0 ? setStep(1) : void sign())}>
            <Busy busy={busy}>{step === 1 ? <CheckIcon size={20} /> : null}</Busy>
            {step === 0 ? t("portal.common.next") : t("portal.answer.sign.submit")}
          </button>
        </div>
      }
    >
      <StepDots count={2} at={step} label={t("portal.pay.progress", { step: step + 1, total: 2 })} />
      <p className="mt-4 truncate text-sm font-semibold text-muted-foreground">{title}</p>

      {step === 0 ? (
        <div className="mt-4">
          {starting && !start ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("portal.answer.sign.sending")}
            </p>
          ) : start ? (
            <div className="flex items-start gap-3">
              <IconDisc tone="brand" size={40}>
                <MailIcon size={20} />
              </IconDisc>
              <p className="min-w-0 text-[0.95rem] text-foreground">{t("portal.answer.sign.sentTo", { email: start.signer.email_masked })}</p>
            </div>
          ) : null}
          {start ? (
            <>
              <CodeInput value={code} onChange={setCode} disabled={busy} label={t("portal.answer.sign.codeLabel")} />
              <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm mt-3" onClick={() => void resend()}>
                <RefreshIcon size={16} />
                {t("portal.answer.sign.resend")}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          {offer.length > 1 ? (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("portal.answer.sign.how")}>
              {offer.map((c) => (
                <button key={c.preset_code} type="button" className="pt-chip !h-auto flex-col !gap-1 !py-3" aria-pressed={card === c.preset_code} onClick={() => setCard(c.preset_code)}>
                  <span className="text-sm font-semibold">{t(`portal.answer.sign.card.${c.preset_code}`)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <TextField label={t("portal.answer.sign.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" />
          <TextField label={t("portal.answer.sign.role")} value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} placeholder={t("portal.answer.sign.rolePlaceholder")} autoComplete="organization-title" />
          {card === "DRAWN" ? (
            <div>
              <p className="pt-label">{t("portal.answer.sign.draw")}</p>
              <SignaturePad onChange={setMark} label={t("portal.answer.sign.draw")} />
            </div>
          ) : (
            <div className="pt-sign-stamp" aria-hidden="true">
              <span className="block text-[1.05rem] font-bold text-foreground">{name.trim() || "—"}</span>
              {role.trim() ? <span className="block text-sm text-muted-foreground">{role.trim()}</span> : null}
              <span className="pt-num mt-1 block text-xs text-muted-foreground">{dateFmt(new Date())}</span>
            </div>
          )}
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{agree}</span>
            <InfoButton title={t("portal.answer.sign.aboutTitle")} label={t("portal.answer.sign.aboutTitle")}>
              <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{t("portal.answer.sign.about")}</p>
            </InfoButton>
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

/* ── decline ─────────────────────────────────────────────────────────────── */

export function DeclineSheet({
  open,
  api,
  id,
  reasons,
  sendLabel,
  onClose,
  onDone,
}: {
  open: boolean;
  api: OfferAnswerApi;
  id: string;
  reasons: DeclineReason[];
  /** The button, in the document's own words. */
  sendLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    setError(null);
  }, [open]);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.decline(id, reason, note.trim() || undefined);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("portal.answer.declineTitle")}
      footer={
        <button type="button" className="pt-btn pt-btn-danger pt-btn-block" disabled={!reason || busy} onClick={() => void send()}>
          <Busy busy={busy}>
            <CloseIcon size={20} />
          </Busy>
          {sendLabel}
        </button>
      }
    >
      <div className="grid gap-2">
        {reasons.map((r) => (
          <button key={r.reason_code} type="button" className={cn("pt-chip justify-start")} aria-pressed={reason === r.reason_code} onClick={() => setReason(r.reason_code)}>
            {r.label}
          </button>
        ))}
      </div>
      <TextArea className="mt-4" label={t("portal.answer.declineNote")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={400} />
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

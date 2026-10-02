/**
 * The signer's confirmation — fingerprint / face, or an emailed code — for one
 * document. Server: src/modules/vault/document_signature/signing-proof.service.
 * The UI that asks for it is `useSigningProof()` (components/signing).
 */
import { tenant } from "@/lib/api-client";

/** What a signing route takes as `proof`. */
export type SigningProof =
  | { passkey: { assertion: Record<string, unknown>; challenge_token: string } }
  | { otp_code: string }
  // This session's 5-minute signing window (meeting 6, F6): one confirmation
  // covers the same person's further signatures here for 5 minutes.
  | { window: true };

export type SigningTarget = { entityRef: string; docType: string };

export const proofOptions = (t: SigningTarget) =>
  tenant<{ has_passkey: boolean; options: Record<string, unknown> | null }>(
    "/signatures/proof/options",
    {
      method: "POST",
      body: { entity_ref: t.entityRef, doc_type: t.docType },
    },
  );

export const sendSigningCode = (t: SigningTarget) =>
  tenant<{ sent_to?: string | null; expires_at?: string | null }>(
    "/signatures/proof/otp",
    {
      method: "POST",
      body: { entity_ref: t.entityRef, doc_type: t.docType },
    },
  );

/** The 5-minute signing window on THIS session (server: signing-window.service). */
export type SigningWindowState = {
  open: boolean;
  window_id: string | null;
  opened_at: string | null;
  expires_at: string | null;
  proof_method: "PASSKEY" | "OTP" | null;
  signature_count: number;
};

export const getSigningWindow = () =>
  tenant<SigningWindowState>("/signatures/proof/window");

export const endSigningWindow = () =>
  tenant<SigningWindowState>("/signatures/proof/window/end", { method: "POST" });

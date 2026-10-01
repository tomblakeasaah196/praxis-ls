/**
 * Share a client's portal SIGN-IN link by hand — "Send on WhatsApp" and "Copy
 * link" (tenant review of 29 Sep 2026, item 1.8, owner decision D4).
 *
 * The invitation is emailed, and when the mail does not arrive (a tenant
 * domain with broken DNS, a spam filter) the person was stuck. The link shared
 * here is the portal's sign-in page with their email filled in: they ask for
 * a 6-digit code by email and are in. It is NEVER the set-password token — that
 * stays between the invitation email and its owner, and a link that passes
 * through a staff member's WhatsApp would be a credential in a third party's
 * chat history.
 *
 * The message is written in the PERSON's language, not the staff member's:
 * the same Elisha who reads the portal in French reads this in French.
 */

export type ShareLanguage = "en" | "fr";

const NNBSP = " ";

/** "Bonjour Elisha, voici votre portail client SMART LS : …" */
export function signInMessage({
  language,
  name,
  tenant,
  url,
}: {
  language: ShareLanguage | string | null | undefined;
  name: string | null | undefined;
  tenant: string | null | undefined;
  url: string;
}): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const who = tenant || "";
  if (language === "fr") {
    return [
      `${first ? `Bonjour ${first}` : "Bonjour"},`,
      `voici votre portail client ${who}${NNBSP}: ${url}`,
      `Saisissez votre adresse e-mail${NNBSP}: nous vous envoyons un code à 6 chiffres pour vous connecter.`,
    ].join("\n");
  }
  return [
    `${first ? `Hello ${first}` : "Hello"},`,
    `here is your ${who} client portal: ${url}`,
    "Enter your email address and we send you a 6-digit code to sign in.",
  ].join("\n");
}

/** Digits only, international form — what wa.me reads. Null when there is no usable number. */
export function waNumber(phone: string | null | undefined): string | null {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  // A number of fewer than eight digits is not a mobile anywhere wa.me reaches.
  return digits.length >= 8 ? digits : null;
}

/** wa.me with the person's mobile when we have one, else WhatsApp's own picker. */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n || ""}?text=${encodeURIComponent(text)}`;
}

/** The link carries an email and nothing else: no token, no code, no session. */
export function isSafeSignInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/\/portal\/login$/.test(u.pathname)) return false;
    return [...u.searchParams.keys()].every((k) => k === "email");
  } catch {
    return false;
  }
}

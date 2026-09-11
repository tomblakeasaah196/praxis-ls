/**
 * Day-first date conversion — the ONE implementation, shared by both apps.
 *
 * The tenant client and the platform console each render their own `DateField`
 * (one is Tailwind + the `Input` primitive, the other is the console's plain
 * CSS), but the part that must not differ is this: what counts as a real date,
 * and how dd/mm/yyyy maps to the ISO the API stores. A second copy of that is a
 * second place for "is 31/02 a date" to be answered differently — so the
 * console imports this file by relative path, exactly as its
 * `eslint-local-rules/index.cjs` imports the client's rule implementations and
 * for the same stated reason.
 *
 * Deliberately dependency-free: no imports, no path aliases, nothing that has
 * to resolve through a bundler config. That is what lets a second app consume
 * it by relative path without any new plumbing.
 */

/** ISO `YYYY-MM-DD` → display `dd/mm/yyyy` (empty for anything else). */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Display `dd/mm/yyyy` → ISO `YYYY-MM-DD`, or "" when incomplete/impossible.
 *  The round-trip check rejects a real-looking-but-invalid date like 31/02. */
export function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return "";
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  )
    return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Keep only digits and re-insert the slashes as the operator types. */
export function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * The sentence a browser shows when the box does not hold a usable date, or
 * `""` when it does. ISO strings compare lexicographically, so `min`/`max` need
 * no parsing.
 *
 * `t` translates; pass `tr` in the client, identity in the console (which is
 * English-only, Praxis-side).
 */
export function validityMessage(
  text: string,
  iso: string,
  {
    required,
    min,
    max,
    t = (s: string) => s,
  }: {
    required?: boolean;
    min?: string;
    max?: string;
    t?: (s: string) => string;
  },
): string {
  if (!text) return required ? t("Enter a date.") : "";
  if (!iso) return t("Enter a real date as dd/mm/yyyy.");
  if (min && iso < min)
    return `${t("Choose a date on or after")} ${isoToDisplay(min)}.`;
  if (max && iso > max)
    return `${t("Choose a date on or before")} ${isoToDisplay(max)}.`;
  return "";
}

/** The legal name as a page prints it: the form only when the name does not already say it. See display.js. */
export function legalNameWithForm(name: string | null | undefined, form: string | null | undefined): string;
/** True when the name already carries the form or its equivalent (LTD for a SARL). */
export function nameCarriesForm(name: string | null | undefined, form: string | null | undefined): boolean;
/** A stored E.164 phone grouped for reading: "+237233420281" reads "+237 233 42 02 81". */
export function phoneDisplay(phone: string | null | undefined): string;
/** The `tel:` href for a phone: digits and the leading plus only. */
export function phoneHref(phone: string | null | undefined): string;

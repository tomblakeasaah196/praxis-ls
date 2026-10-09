/** The printed verification code's alphabet, length and read-side rules — see verify-code.js. */
export const ALPHABET: string;
export const CODE_LENGTH: number;
/** Fold what a human typed (case, separators, Crockford confusables) to the stored spelling. */
export function normaliseCode(input: string | null | undefined): string;
/** Exactly CODE_LENGTH characters, all in ALPHABET. Nothing else is a verification code. */
export function isValidCode(input: string | null | undefined): boolean;
/** `A4B7K92MXQ1P` → `A4B7-K92M-XQ1P`. Display only; never stored or sent. */
export function formatCode(input: string | null | undefined): string;
/** `formatCode`, capped at CODE_LENGTH first — safe to run on every keystroke. */
export function formatPartial(input: string | null | undefined): string;

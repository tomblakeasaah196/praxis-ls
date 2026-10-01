/** Title Case with each language's small words left small — see title-case.js. */
export function titleCase<T extends string | null | undefined>(label: T, lang?: "en" | "fr" | string): T extends string ? string : T;
export const SMALL_WORDS: { fr: Set<string>; en: Set<string> };

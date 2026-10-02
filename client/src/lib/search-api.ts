/**
 * ⌘K's record search — GET /search (tenant review, meeting 6, PR 4 — G5).
 *
 * The term is checked with the SAME schema the API validates it with
 * (`search.query` in @praxis/shared), so the palette never sends a request the
 * server would refuse: under two letters it asks nothing at all.
 *
 * The server answers only for the modules this person may view (each provider
 * is gated on its module's `view` grant) and only from the environment the
 * session is in (LIVE or TEST). The palette still drops any row whose address
 * `canOpenRoute` refuses — the second lock on the same door.
 */
import { search } from "@praxis/shared";
import { tenant } from "./api-client";

export type RecordHit = {
  id: string;
  type: string;
  ref: string | null;
  title: string | null;
  title_fr: string | null;
  sub: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  url: string;
};
export type RecordGroup = {
  type: string;
  module: string;
  label: { en: string; fr: string };
  route: string;
  items: RecordHit[];
};
export type SearchAnswer = { q: string; hint: string | null; groups: RecordGroup[] };

const EMPTY: SearchAnswer = { q: "", hint: null, groups: [] };

/** True when the term is one the API would accept. */
export const searchable = (q: string) => search.query.safeParse({ q }).success;

export async function searchRecords(
  q: string,
  opts: { types?: string[]; limit?: number; signal?: AbortSignal } = {},
): Promise<SearchAnswer> {
  const parsed = search.query.safeParse({
    q,
    ...(opts.types && opts.types.length ? { types: opts.types.join(",") } : {}),
    ...(opts.limit ? { limit: opts.limit } : {}),
  });
  if (!parsed.success) return EMPTY;
  const params = new URLSearchParams({ q: parsed.data.q });
  if (parsed.data.types) params.set("types", parsed.data.types);
  if (parsed.data.limit) params.set("limit", String(parsed.data.limit));
  return tenant<SearchAnswer>(`/search?${params.toString()}`, { signal: opts.signal });
}

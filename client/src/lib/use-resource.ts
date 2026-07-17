/**
 * Shared data-fetch hooks — the four-states helper every wired screen uses.
 * `useList(path)` fetches a tenant list endpoint into `{ rows, error, loading,
 * reload }`; `useResource(fn, deps)` does the same for a single/custom fetch.
 * 403 becomes a permission message (never a crash), matching FE_DESIGN_RULES §3.
 */
import * as React from "react";
import { tenant, ApiError } from "./api-client";

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    return e.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

export function useList<T = Record<string, unknown>>(path: string | null) {
  const [rows, setRows] = React.useState<T[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  React.useEffect(() => {
    if (!path) return;
    let live = true;
    setRows(null);
    setError(null);
    tenant<T[]>(path)
      .then((d) => { if (live) setRows(Array.isArray(d) ? d : []); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [path, nonce]);
  return { rows, error, loading: rows === null && !error, reload };
}

export function useResource<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  React.useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fn()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, error, loading: data === null && !error, reload };
}

/**
 * The go-live checklist's data (meeting 6, register 3.9) — see
 * components/getting-started.tsx for what it shows and why.
 *
 * Tolerant without a catch: a failed read leaves `data` empty, which is "no
 * checklist", never a broken tower; and it is not retried, because the tower
 * is complete without it.
 */
import { useQuery } from "@tanstack/react-query";
import { tenant } from "@/lib/api-client";
import { tenantKey } from "@/lib/query-client";

export type GettingStarted = {
  show: boolean;
  env: "live" | "sandbox";
  done?: number;
  total?: number;
  items: {
    key: string;
    label: string;
    to: string;
    done: boolean;
    count: number;
  }[];
};

const PATH = "/dashboard/getting-started";

/** The checklist, or null. Never asked for in TEST (`enabled` false). */
export function useGettingStarted(enabled: boolean): GettingStarted | null {
  const q = useQuery({
    queryKey: tenantKey(PATH),
    queryFn: () => tenant<GettingStarted>(PATH),
    enabled,
    retry: false,
  });
  return enabled && !q.isError && q.data && q.data.show ? q.data : null;
}

/**
 * ScreenAi — drop-in per-screen Praxis panel. Looks up a screen's `ai` actions by
 * path from screen-specs and renders the shared, self-gating <AiActions/> (nothing
 * shows when the tenant has AI off, per doc/AI_GATE_BE_HANDOFF.md). One line per screen:
 *   <ScreenAi path="procurement/purchase-orders" />
 */
import { AiActions } from "@/components/ai-actions";
import { SPECS_BY_PATH } from "@/features/scaffold/screen-specs";

export function ScreenAi({ path }: { path: string }) {
  return <AiActions actions={SPECS_BY_PATH[path]?.ai} />;
}

/**
 * Typed accessor over the canonical UI screen registry (screen-registry.json).
 * The JSON is the single source of truth — the AI ingests it as the app's screen
 * map, and the frontend can use it for navigation/breadcrumbs. Keep the JSON in
 * sync when you add a <Route> (see doc/AI_READINESS.md).
 */
import registry from "./screen-registry.json";

export interface Screen {
  id: string;
  title: string;
  route: string;
  area: string;
  module_key: string | null;
  purpose: string;
  actions: string[];
  public?: boolean;
}

export const SCREENS: Screen[] = (registry.screens as Screen[]);
export const screenByRoute = (route: string): Screen | undefined =>
  SCREENS.find((s) => s.route === route);
export const screensForModule = (moduleKey: string): Screen[] =>
  SCREENS.filter((s) => s.module_key === moduleKey);

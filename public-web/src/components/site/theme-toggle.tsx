import * as React from "react";
import { useTranslation } from "react-i18next";
import { getMode, setMode, type ThemeMode } from "@/lib/theme-mode";
import { useSiteSwitches } from "@/lib/site-switches";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

/**
 * Light / dark. Two states, no "system", and the choice persists.
 *
 * `client`'s equivalent cycles light → dark → system, which is right for an app
 * somebody lives in for eight hours and wrong for a page somebody reads for two
 * minutes: a third state means a visitor cannot tell what they have selected.
 * (Unlocked, the two states default to DARK and only an explicit press writes
 * light — the OS setting is not consulted.)
 *
 * There is no flash to fix here — `index.html`'s inline script has already
 * settled the mode before first paint, which is the only reason a pre-paint
 * theme script is allowed to exist in this repo.
 *
 * ── ONLY WHEN THE TENANT OFFERS IT (website v2) ───────────────────────────
 *
 * The site is light by default with dark photographic bands. A visitor switch
 * is one of the website's options (Settings › Website › Options), off until a
 * tenant turns it on, so this renders nothing until then. `setMode` is a no-op
 * in the same state, so there is never a control that changes nothing.
 */
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const [mode, setLocal] = React.useState<ThemeMode>(() => getMode());
  const next: ThemeMode = mode === "dark" ? "light" : "dark";
  const Icon = mode === "dark" ? SunIcon : MoonIcon;
  const label =
    mode === "dark" ? t("site.chrome.themeLight") : t("site.chrome.themeDark");

  const { visitor_theme_switch: offered } = useSiteSwitches();
  // After the hooks, never before: the switch can arrive after first paint,
  // and React counts hooks by call order.
  if (!offered) return null;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        setMode(next);
        setLocal(next);
      }}
      className={
        onDark
          ? "grid h-8 w-8 place-items-center rounded-full text-[var(--hero-muted)] transition-colors hover:bg-[rgb(237_238_238/0.14)] hover:text-[var(--hero-foreground)]"
          : "btn-surface grid h-9 w-9 place-items-center rounded-full"
      }
    >
      <Icon size={16} />
    </button>
  );
}

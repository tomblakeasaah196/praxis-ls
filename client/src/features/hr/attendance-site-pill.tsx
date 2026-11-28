import { Pill } from "@/components/ui/pill";
import i18n from "@/lib/i18n";
import type { AttendanceRow } from "@/lib/hr-api";

export function SitePill({
  within,
  status,
}: {
  within?: boolean | null;
  status?: AttendanceRow["location_status"];
}) {
  const s = status || (within === true ? "on_site" : within === false ? "off_site" : "no_gps");
  if (s === "on_site") return <Pill tone="ok">{i18n.t("hr.onSite")}</Pill>;
  if (s === "off_site") return <Pill tone="bad">{i18n.t("hr.offSite")}</Pill>;
  if (s === "unfenced") return <Pill tone="mute">{i18n.t("hr.noWorksite")}</Pill>;
  // 14403: a reading that arrived after the tap. Shown, never a verdict.
  if (s === "delayed_gps") return <Pill tone="warn">{i18n.t("hr.delayedGps")}</Pill>;
  // "Location Not Verified" (owner's word, 28 Nov 2026): the punch counts, it
  // simply carried no location to check. A flag to look at, not a fault.
  return <Pill tone="warn">{i18n.t("hr.noGps")}</Pill>;
}

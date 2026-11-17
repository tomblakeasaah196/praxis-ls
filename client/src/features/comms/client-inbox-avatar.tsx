/**
 * The avatar disc with initials that a row of the Chat list wears, for the
 * rows and the header of the Client inbox.
 *
 * It exists in `team-chat.tsx`, private to that file. It is repeated here
 * rather than exported from there because Comms › Clients was redesigned to
 * match Chat while Chat itself was being changed (17 Nov 2026), and two changes
 * to one file is how a merge loses one of them. When that settles, Chat should
 * import this one and its own copy go: one avatar.
 *
 * The colours are a fixed per-name set and deliberately NOT the tenant's
 * accent, exactly as in Chat: the colour's job is to tell two rows apart, and
 * the brand colour is the same on every row.
 */
import { cn } from "@/lib/cn";

const AVATAR_COLOURS = ["#C9A86C", "#7FB069", "#5B9BD5", "#C0626E", "#9B7EDE", "#4DB6AC", "#E2934D", "#D46BA3"];

function avatarColour(name?: string | null): string {
  if (!name) return AVATAR_COLOURS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

/** "Acme Trading" gives "AT"; a single word gives one letter. */
function initials(name?: string | null): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[12px]",
} as const;

/**
 * The initials disc. Decorative: the name it shortens is always printed beside
 * it, so announcing "AT" as well would only be noise.
 */
export function ChatAvatar({ name, size = "md" }: { name?: string | null; size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white", SIZES[size])}
      style={{ backgroundColor: avatarColour(name) }}
    >
      {initials(name)}
    </span>
  );
}

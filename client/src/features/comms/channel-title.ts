import type { Channel } from "@/lib/smartcomm-api";

/**
 * What a conversation is called, for the person looking at it.
 *
 * A DIRECT conversation is the OTHER person. Its stored `name` is what the one
 * who started it saw, so the one who was messaged read their own name on the
 * list, on the header and on the call they placed from it. The server resolves
 * the partner against the viewer (`partner_name`), and every place that shows
 * a channel's name goes through here.
 *
 * Its own module, not a function on the API client: the chat tests replace
 * that client wholesale, and this must be the real thing in them.
 */
export function channelTitle(c: Pick<Channel, "name" | "kind" | "partner_name"> | null | undefined): string {
  if (!c) return "";
  return (c.kind === "DIRECT" && c.partner_name ? c.partner_name : c.name) || "";
}

/**
 * A call's transcript as a conversation (transcript-conversation.tsx).
 *
 * The server lays both sides of a call on one clock and returns turns. What
 * is pinned here is the drawing, and the rule for when it is used: a call with
 * no sentence times is NOT drawn as a conversation, because it has no order to
 * show (owner decision, 17 Nov 2026: old calls stay as they are).
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CallTranscriptTurn } from "@/lib/smartcomm-api";
import { TranscriptConversation } from "./transcript-conversation";
import { isConversation } from "./call-labels";

const TURNS: CallTranscriptTurn[] = [
  { side: "caller", name: "Joel Efala", at_s: 5, text: "Okay, can you hear me from the computer?", language: "en", exact: true },
  { side: "callee", name: "JBS Praxis", at_s: 9, text: "From the computer, yes. Oh, it records calls.", language: "en", exact: true },
  { side: "caller", name: "Joel Efala", at_s: 134, text: "Yes, the calls are recorded.", language: "en", exact: true },
];

describe("the conversation", () => {
  it("is drawn in the order it was said, each turn with when it began, who, and what", () => {
    render(<TranscriptConversation turns={TURNS} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("00:05")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Joel Efala")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Okay, can you hear me from the computer?")).toBeInTheDocument();
    expect(within(rows[1]).getByText("00:09")).toBeInTheDocument();
    expect(within(rows[1]).getByText("JBS Praxis")).toBeInTheDocument();
    // Past a minute it is minutes and seconds, not a count of seconds.
    expect(within(rows[2]).getByText("02:14")).toBeInTheDocument();
  });

  it("a person the server could not name is the caller or the callee", () => {
    render(<TranscriptConversation turns={[{ side: "callee", name: null, at_s: 0, text: "Hello", exact: true }]} />);
    expect(screen.getByText("Callee")).toBeInTheDocument();
  });

  it("a stretch with no transcript says so, and until when", () => {
    render(<TranscriptConversation turns={[{ side: "caller", name: "Joel Efala", at_s: 120, to_s: 240, gap: true }]} />);
    expect(screen.getByText("02:00")).toBeInTheDocument();
    expect(screen.getByText("Not transcribed until 04:00")).toBeInTheDocument();
  });

  it("a turn placed by its part, not by its sentences, says its time is approximate", () => {
    render(<TranscriptConversation turns={[
      { side: "caller", name: "Joel Efala", at_s: 120, text: "the whole part", exact: false },
      { side: "callee", name: "JBS Praxis", at_s: 130, text: "an exact reply", exact: true },
    ]} />);
    expect(screen.getAllByText("time approximate")).toHaveLength(1);
  });
});

describe("when a transcript is drawn as a conversation", () => {
  it("only when the times were kept and there are turns", () => {
    expect(isConversation({ timed: true, turns: TURNS })).toBe(true);
    expect(isConversation({ timed: false, turns: TURNS })).toBe(false);
    expect(isConversation({ timed: true, turns: [] })).toBe(false);
  });

  it("never for an older server's answer, which has neither field", () => {
    expect(isConversation({})).toBe(false);
    expect(isConversation(null)).toBe(false);
  });
});

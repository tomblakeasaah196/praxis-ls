/**
 * A client's questions on a stage, on the operations file (tenant review of
 * 29 Sep 2026, item 1.7): the stage shows its count, opens its own thread,
 * and an answer goes into the shipment's conversation, naming the stage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as { path: string; method?: string; body?: unknown }[]);

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      if (opts?.method === "POST") return Promise.resolve({});
      return base.tenant(path);
    },
  };
});

import { StageQuestionsThread, StageQuestionsToggle } from "./stage-questions";

const STAGE = "m-arrival";
const msg = (over: Record<string, unknown>) => ({
  message_id: "x", direction: "CLIENT", body: "", created_at: "2026-09-30T09:00:00Z",
  author: { name: "Elisha Godwin", email: "elisha@goum.cm" }, seen: false, milestone: null, location: null, attachments: [],
  ...over,
});

beforeEach(() => {
  calls.length = 0;
});

describe("a stage's client questions", () => {
  it("shows the count, and the new ones", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderScreen(
      <StageQuestionsToggle
        count={{ milestone_instance_id: STAGE, questions: 2, unread: 1, messages: 3, last_at: null }}
        open={false}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole("button", { name: /2 client questions · 1 new/ }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("opens that stage's thread only, and answers into the shipment's conversation", async () => {
    const user = userEvent.setup();
    renderScreen(
      <StageQuestionsThread clientId="c1" dossierId="d1" milestoneId={STAGE} stageLabel="Arrival in Douala" />,
      {
        routes: {
          "/portal/chat/messages": {
            thread: "d1",
            has_more: false,
            messages: [
              msg({ message_id: "q1", body: "Is the ship in?", milestone: { milestone_instance_id: STAGE, label: "Arrival in Douala" } }),
              msg({ message_id: "q2", body: "About customs", milestone: { milestone_instance_id: "m-customs", label: "Customs" } }),
            ],
          },
        },
      },
    );
    expect(await screen.findByText("Is the ship in?")).toBeInTheDocument();
    expect(screen.queryByText("About customs")).toBeNull();
    // Opening it is reading it — the client's "seen".
    expect(calls.some((c) => c.path === "/portal/chat/read" && c.method === "POST")).toBe(true);

    await user.type(screen.getByLabelText("Answer about Arrival in Douala"), "Berthed this morning.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(calls.find((c) => c.path === "/portal/chat/messages" && c.method === "POST")?.body).toEqual({
      client_id: "c1", thread: "d1", body: "Berthed this morning.", milestone_instance_id: STAGE,
    });
  });
});

/**
 * Tenant review of 29 Sep 2026, PR 1 — the staff screens of sections A and B:
 *
 *   · Accept asks for the fields a document type is filed with, and only those
 *     (D1) — refusing to send until a required one is filled;
 *   · "Request from client" lists the Documents tab's own types with where each
 *     stands, cannot ask twice for a type already requested, and sends one
 *     request per type picked (D2);
 *   · each team message says what its email did (D8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
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
      if (opts?.method === "POST") return Promise.resolve([{}, {}]);
      return base.tenant(path);
    },
  };
});

import { AcceptDocumentDialog, RequestFromClientDialog, standingOf } from "./client-kyc";
import { deliveryLines } from "./client-message-email";
import { dateFmt, dateTimeFmt } from "@/lib/format";
import type { StaffRequest } from "./client-portal-staff";

const posts = () => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  calls.length = 0;
});

const RCCM_REQUEST = {
  client_request_id: "rq-1", client_id: "c1", client_name: "GOUM", dossier_id: null, dossier_ref: null,
  source: "STAFF", kind: "DOCUMENT", doc_type_code: "RCCM", doc_type_en: "Trade register (RCCM)", doc_type_fr: null,
  title: null, note: null, due_on: null, status: "SUBMITTED", answer_text: null, answer_doc_id: "d-1",
  answer_doc_name: "rccm.pdf", answered_at: "2026-09-30T10:00:00Z", review_note: null, created_at: "2026-09-29T10:00:00Z",
  files_as: { document_type_id: "00000000-0000-4000-8000-0000000000a1", code: "BUSINESS_LICENSE", name: "Business Licence / RCCM", requires_expiry: true, requires_issuing_authority: true },
  accept_fields: { asks: true, issued_on: true, expires_on: true, issuing_authority: true },
} as StaffRequest;

describe("Accept files a KYC upload with the fields its type requires (D1)", () => {
  it("asks for the expiry and the authority, and will not accept without them", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn(async () => {});
    renderScreen(<AcceptDocumentDialog request={RCCM_REQUEST} onClose={() => {}} onAccept={onAccept} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("File as Business Licence / RCCM")).toBeInTheDocument();
    // The number is the system's, assigned on save — as on "Add document".
    expect(within(dialog).getByDisplayValue("Assigned on save")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Accept and file" }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(within(dialog).getByText("This document type is filed with its expiry date.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Expires/), "01/02/2029");
    await user.type(within(dialog).getByLabelText(/Issuing authority/), "Greffe de Douala");
    await user.click(within(dialog).getByRole("button", { name: "Accept and file" }));
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ expires_on: "2029-02-01", issuing_authority: "Greffe de Douala" }));
  });

  it("asks nothing for a type that requires nothing", async () => {
    const plain = { ...RCCM_REQUEST, files_as: { ...RCCM_REQUEST.files_as!, requires_expiry: false, requires_issuing_authority: false } } as StaffRequest;
    renderScreen(<AcceptDocumentDialog request={plain} onClose={() => {}} onAccept={async () => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Expires/)).toBeNull();
    expect(within(dialog).queryByLabelText(/Issuing authority/)).toBeNull();
  });
});

const TYPES = [
  { document_type_id: "00000000-0000-4000-8000-0000000000a1", code: "BUSINESS_LICENSE", name: "Business Licence / RCCM", applies_to: "BOTH", is_active: true },
  { document_type_id: "00000000-0000-4000-8000-0000000000a2", code: "FISCAL_COMPLIANCE", name: "Attestation de Conformité Fiscale", applies_to: "CLIENT", is_active: true },
  { document_type_id: "00000000-0000-4000-8000-0000000000a3", code: "TAXPAYER_CARD", name: "Taxpayer Card (NIU)", applies_to: "BOTH", is_active: true },
  { document_type_id: "00000000-0000-4000-8000-0000000000a4", code: "OLD", name: "Retired type", applies_to: "CLIENT", is_active: false },
  { document_type_id: "00000000-0000-4000-8000-0000000000a5", code: "OTHER", name: "Other", applies_to: "BOTH", is_active: true },
] as const;

const STATUS = {
  activation_type_ids: ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"],
  on_file: [{ document_type_id: "00000000-0000-4000-8000-0000000000a3", expires_on: "2030-12-31", verification_status: "VERIFIED" }],
  requested: [{ document_type_id: "00000000-0000-4000-8000-0000000000a1", status: "OPEN", created_at: "2026-09-29T09:00:00Z" }],
};

describe("Request from client (D2)", () => {
  it("lists the same active types as Add document, with where each stands", async () => {
    renderScreen(
      <RequestFromClientDialog open clientId="c1" types={TYPES as never} onClose={() => {}} />,
      { routes: { "/portal/clients/c1/document-status": STATUS } },
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Required to activate")).toBeInTheDocument();
    // Day-first, through the app's own formatter.
    expect(within(dialog).getByText(`On file · valid until ${dateFmt("2030-12-31")}`)).toBeInTheDocument();
    expect(within(dialog).getByText(`Requested ${dateFmt("2026-09-29T09:00:00Z")}`)).toBeInTheDocument();
    // Inactive types are not offered, and OTHER is the "describe it" option.
    expect(within(dialog).queryByText("Retired type")).toBeNull();
    // A type already requested cannot be asked for twice.
    expect(within(dialog).getByRole("checkbox", { name: "Business Licence / RCCM" })).toBeDisabled();
  });

  it("sends one request per type picked, plus a described one", async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    renderScreen(
      <RequestFromClientDialog open clientId="c1" types={TYPES as never} onClose={() => {}} onSent={onSent} />,
      { routes: { "/portal/clients/c1/document-status": STATUS } },
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("checkbox", { name: "Attestation de Conformité Fiscale" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Other — describe it" }));
    await user.type(within(dialog).getByLabelText(/What you need/), "Lease of the warehouse");
    await user.click(within(dialog).getByRole("button", { name: "Request 2 documents" }));
    expect(posts()).toEqual([
      {
        path: "/portal/clients/c1/document-requests",
        method: "POST",
        body: { items: [{ document_type_id: "00000000-0000-4000-8000-0000000000a2" }, { other: "Lease of the warehouse" }], note: undefined, due_on: undefined },
      },
    ]);
    expect(onSent).toHaveBeenCalled();
  });

  it("an expired document is missing again", () => {
    const expired = { ...STATUS, on_file: [{ document_type_id: "00000000-0000-4000-8000-0000000000a3", expires_on: "2020-01-01", verification_status: "VERIFIED" }] };
    expect(standingOf("00000000-0000-4000-8000-0000000000a3", expired, "2026-10-01")).toEqual({ kind: "missing", activation: false });
  });
});

describe("what each team message's email did (D8)", () => {
  it("names who was emailed, by whom, who read it and who could not be emailed", () => {
    const lines = deliveryLines([
      { email: "elisha@goum.cm", name: "Elisha Godwin", state: "EMAILED", at: "2026-09-30T10:42:00Z", by: "Tom", manual: true },
      { email: "paul@goum.cm", name: "Paul", state: "READ", at: "2026-09-30T10:05:00Z" },
      { email: "new@goum.cm", name: "Awa", state: "NEVER_SIGNED_IN" },
    ]);
    expect(lines[0]).toBe(`Emailed to Elisha Godwin · ${dateTimeFmt("2026-09-30T10:42:00Z")} · by Tom`);
    expect(lines).toContain("Read in the portal by Paul — no email needed");
    expect(lines).toContain("Not emailed: never signed in (Awa)");
  });

  it("says nothing when there is nothing to say", () => {
    expect(deliveryLines([])).toEqual([]);
    expect(deliveryLines(undefined)).toEqual([]);
  });
});

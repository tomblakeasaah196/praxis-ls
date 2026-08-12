/**
 * Attaching a file while CREATING the record — the three calls, in order.
 *
 * WHY THE ORDER IS THE TEST. A vault row records which record it belongs to
 * (`entity_ref`), and a record being created has no id until the API issues
 * one. So "attach during creation" is necessarily create → upload → patch, and
 * the only way to get it wrong quietly is to send the File in the create body
 * (where the shared schema silently drops it) and never notice the scan did not
 * arrive. That is the failure this pins.
 *
 * It also pins the partial-failure rule, which is a decision rather than an
 * accident: if the upload fails, the RECORD STAYS. A registration with no
 * certificate is a valid registration, and throwing the typed details away
 * because the file did not land would lose the half that worked — and would
 * hold the modal open on a record that already exists, where pressing Save
 * again files a duplicate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

// `vi.hoisted` because the mock factory is lifted above the imports: a plain
// top-level const would not exist yet when the factory runs.
const h = vi.hoisted(() => ({
  calls: [] as { path: string; method: string; body: Record<string, unknown> }[],
  vaultFails: false,
}));

vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (!opts?.method || opts.method === "GET") return base.tenant(path);
      h.calls.push({ path, method: opts.method, body: opts.body ?? {} });
      if (opts.method === "POST" && path === "/documents") {
        if (h.vaultFails) return Promise.reject(new Error("upload exploded"));
        return Promise.resolve({ doc_id: "vault-9" });
      }
      if (path === "/entities/e1/documents") return Promise.resolve({ document_id: "doc-new" });
      if (path === "/entities/e1/registrations") return Promise.resolve({ registration_id: "reg-new" });
      return Promise.resolve({});
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { EntityDossier } from "./entity-360";

const ENTITY_360 = {
  entity: { entity_id: "e1", code: "SLAS", legal_name: "Smart Logistics & Services Ltd", legal_form: "SARL", country_code: "CM", registration_status: "ACTIVE", is_active: true, default_currency: "XAF" },
  structure: { parent_entity_id: null, relationship_type: null, ownership_percent: null, consolidates: false, is_group_parent: true, ancestors: [], children: [] },
  people: [], contacts: [], addresses: [], registrations: [], establishments: [],
  documents: [], tax_registrations: [], tax_obligations: [], treasury_accounts: [], treasury_is_read_only: true,
  cap_table: { as_of: "2026-07-01", holder_count: 0, total_percent: 0, total_shares: 0, issued_capital: 0, balanced: true, findings: [] },
  usage: { journal_entries: 0, employees: 0, treasury_accounts: 0, subsidiaries: 0 },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [], can_see_governance: true, letterhead_config: null, letterhead_source: {},
  letterhead_preview: { language: "fr", paper_size: "A4", logo_position: "LEFT", header: {}, footer: {}, payment_block: { source: "none", accounts: [] }, identifiers: [], empty_blocks: [] },
  renewals: { as_of: "2026-07-01", items: [], counts: { expired: 0, due: 0, approaching: 0 } },
};

const routes = {
  "/entities/e1/360": ENTITY_360,
  "/party-document-types": [{ document_type_id: "dt1", code: "RCCM", name: "Certificate of incorporation" }],
  "/entities": [], "/employees": [], "/clients": [], "/suppliers": [], "/users": [], "/tax-jurisdictions": [],
};

const pdf = () => new File([new Uint8Array(64)], "rccm.pdf", { type: "application/pdf" });

/**
 * The modal's one file input.
 *
 * By element rather than by label because these forms put the hint INSIDE the
 * `<label>`, so a field's accessible name is "Scan" + its hint sentence and no
 * exact label query can match it. That is a pre-existing wart in the shared
 * modal, not this control's; asserting on the input itself keeps this test
 * about attaching rather than about label composition.
 */
async function fileInputIn(dialogName: RegExp) {
  const dialog = await screen.findByRole("dialog", { name: dialogName });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(input, "the form should offer a file input").not.toBeNull();
  return input as HTMLInputElement;
}

beforeEach(() => { h.calls.length = 0; h.vaultFails = false; });

const open = () => {
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, { routes });
  return userEvent.setup();
};

describe("Corporate entities · attaching while creating", () => {
  it("creates the document, uploads the file, then points the document at it", async () => {
    const user = open();
    await user.click(await screen.findByRole("button", { name: /^documents$/i }));
    await user.click(await screen.findByRole("button", { name: /add document/i }));

    await user.type(await screen.findByLabelText("Title"), "Certificat d'incorporation");
    const scan = await fileInputIn(/add document/i);
    expect(scan.accept).toBe("application/pdf,image/png,image/jpeg,image/webp");
    await user.upload(scan, pdf());
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(h.calls).toHaveLength(3));
    const [create, upload, patch] = h.calls;

    expect(create).toMatchObject({ path: "/entities/e1/documents", method: "POST" });
    // The File must NOT ride along in the record body — the shared schema would
    // drop it without a word and the scan would never exist.
    expect(create.body).toEqual({ title: "Certificat d'incorporation", is_active: true });

    expect(upload).toMatchObject({ path: "/documents", method: "POST" });
    expect(upload.body).toMatchObject({ doc_type: "ENTITY_DOCUMENT", entity_ref: "entity_document:doc-new" });

    expect(patch).toMatchObject({ path: "/entities/e1/documents/doc-new", method: "PATCH", body: { vault_id: "vault-9" } });
  });

  it("files a registration's certificate against the registration, not the document register", async () => {
    const user = open();
    await user.click(await screen.findByRole("button", { name: /identity & registrations/i }));
    await user.click(await screen.findByRole("button", { name: /^add registration$/i }));

    await user.type(await screen.findByLabelText(/^Type/), "RCCM");
    await user.upload(await fileInputIn(/add registration/i), pdf());
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(h.calls).toHaveLength(3));
    // The certificate belongs to the row that carries `verified` — see 0662.
    expect(h.calls[1].body).toMatchObject({ entity_ref: "entity_registration:reg-new" });
    expect(h.calls[2]).toMatchObject({ path: "/entities/e1/registrations/reg-new", body: { vault_id: "vault-9" } });
  });

  it("keeps the record when the upload fails, and says the file is still missing", async () => {
    h.vaultFails = true;
    const user = open();
    await user.click(await screen.findByRole("button", { name: /^documents$/i }));
    await user.click(await screen.findByRole("button", { name: /add document/i }));
    await user.type(await screen.findByLabelText("Title"), "Customs bond 2026");
    await user.upload(await fileInputIn(/add document/i), pdf());
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/the scan was not attached/i)).toBeInTheDocument();
    // Created, upload attempted, and NO patch claiming a scan that isn't there.
    expect(h.calls.map((c) => c.path)).toEqual(["/entities/e1/documents", "/documents"]);
  });
});

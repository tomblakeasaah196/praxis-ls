/**
 * TEAM signatures: mail sent from a SHARED mailbox (info@, operations@).
 *
 * Before this, a message from info@ carried the SENDER's personal signature
 * with only the email line swapped: their name, title, desk line, mobile and
 * WhatsApp, on a generic address, different for every colleague who answered
 * it. A shared mailbox now signs as its team. The sender may add a "Sent by"
 * line to one message; a personal number never goes out on one.
 */
"use strict";

const resolve = require("../../src/modules/mail/signature/signature.resolve");
const html = require("../../src/modules/mail/signature/signature.html");
const card = require("../../src/modules/mail/signature/signature.card");
const repo = require("../../src/modules/mail/signature/signature.repo");
const brandLogo = require("../../src/services/brand-logo.service");
const service = require("../../src/modules/mail/signature/signature.service");

const employee = {
  full_name: "Marie Nguema",
  job_title: "Operations Officer",
  department: "Operations",
  phone_desk: "+237 233 11 11 11",
  phone_mobile: "+237 6 99 99 99 99",
};
const profile = {
  phone_mobile: "+237 6 00 00 00 00",
  whatsapp: "+237 6 55 55 55 55",
  pronouns: "she/her",
  credentials: "FIATA Dip.",
  booking_url: "https://cal.example.com/marie",
};
const entity = {
  legal_name: "Smart Logistics SARL",
  address_line: "Bonanjo",
  po_box: "BP 123",
  city: "Douala",
  country: "CM",
  phone: "+237 233 00 00 00",
  website: "www.smartlogistics.cm",
  logo_url: "https://cdn.example.com/logo.png",
};
const template = {
  layout: { kind: "classic", show_logo: true, show_motto_bar: true },
  copy_en: { motto: "Moving cargo." },
  copy_fr: { motto: "Faire bouger le fret." },
};
const PERSONAL_BITS = [
  "Marie", "Operations Officer", "+237 233 11 11 11", "+237 6 99 99 99 99",
  "+237 6 00 00 00 00", "+237 6 55 55 55 55", "she/her", "FIATA", "cal.example.com",
];

function teamModel(team, lang = "en", over = {}) {
  return resolve.resolve({
    employee, profile, entity, template,
    mailbox: { email_address: "info@smartlogistics.cm" },
    team,
    ...over,
  }, lang);
}

describe("resolve: a team render names the team, not the sender", () => {
  test("team only: the label is the name line and nothing personal survives", () => {
    const m = teamModel({ label: "General Enquiries" });
    expect(m.team).toBe(true);
    expect(m.person.person_line).toBe("General Enquiries");
    expect(m.person.full_name).toBeNull();
    expect(m.person.job_title).toBeNull();
    expect(m.person.department).toBeNull();
    expect(m.contact.phone_desk).toBeNull();
    expect(m.contact.phone_mobile).toBeNull();
    expect(m.contact.whatsapp).toBeNull();
    expect(m.contact.booking_url).toBeNull();
    expect(m.contact.email).toBe("info@smartlogistics.cm");
    expect(m.company.phone).toBe("+237 233 00 00 00");
    const text = resolve.textContent(m);
    for (const bit of PERSONAL_BITS) expect(text).not.toContain(bit);
  });

  test("team + me: a Sent by line, and still no personal number", () => {
    const m = teamModel({ label: "General Enquiries", signed_by: "Marie Nguema" });
    expect(m.person.person_line).toBe("General Enquiries");
    expect(m.person.job_title).toBe("Sent by Marie Nguema");
    const text = resolve.textContent(m);
    expect(text).toContain("Sent by Marie Nguema");
    for (const bit of PERSONAL_BITS.filter((b) => b !== "Marie")) expect(text).not.toContain(bit);
  });

  test("French: the Sent by line is in French", () => {
    const m = teamModel({ label: "Renseignements généraux", signed_by: "Marie Nguema" }, "fr");
    expect(m.person.job_title).toBe("Envoyé par Marie Nguema");
  });

  test("a mailbox with no label at all signs as the company, never as the person", () => {
    const m = teamModel({ label: null });
    expect(m.team).toBe(true);
    expect(m.person.person_line).toBe("Smart Logistics SARL");
    expect(m.contact.phone_mobile).toBeNull();
  });

  test("no gap is reported for the name or title a team render leaves out on purpose", () => {
    expect(teamModel({ label: "Operations" }).empty).toEqual([]);
  });

  test("a SYSTEM render ignores a team: the system rules win", () => {
    const m = teamModel({ label: "General Enquiries" }, "en", { system: true, identity: { purpose: "BILLING" } });
    expect(m.team).toBe(false);
    expect(m.person.department).toBe("Billing");
  });
});

describe("html and card: the company line stands in for the personal numbers", () => {
  test("classic email table carries the team label and the company phone only", () => {
    const out = html.render(teamModel({ label: "General Enquiries" }));
    expect(out).toContain("General Enquiries");
    expect(out).toContain("+237 233 00 00 00");
    for (const bit of PERSONAL_BITS) expect(out).not.toContain(bit);
  });

  test("card fields: the phone row is the company line", () => {
    const m = teamModel({ label: "General Enquiries" }, "en", { template: { layout: { kind: "card" } } });
    const f = card.fields(m);
    expect(f.name).toBe("General Enquiries");
    expect(f.title).toBe("");
    expect(f.phone).toBe("+237 233 00 00 00");
  });

  test("card body drops the empty title row on a team-only card, and keeps it with a Sent by", () => {
    const layout = { template: { layout: { kind: "card" } } };
    const bare = card.body(teamModel({ label: "General Enquiries" }, "en", layout), {});
    expect(bare).not.toContain("person-title-row");
    const signed = card.body(teamModel({ label: "General Enquiries", signed_by: "Marie Nguema" }, "en", layout), {});
    expect(signed).toContain("person-title-row");
    expect(signed).toContain("Sent by Marie Nguema");
  });

  test("card text fallback (no PNG) uses the company line too", () => {
    const m = teamModel({ label: "General Enquiries" }, "en", { template: { layout: { kind: "card" } } });
    const out = html.render(m);
    expect(out).toContain("+237 233 00 00 00");
    for (const bit of PERSONAL_BITS) expect(out).not.toContain(bit);
  });

  test("a personal card is unchanged: mobile on the phone row, title row present", () => {
    const m = resolve.resolve({ employee, profile, entity, template: { layout: { kind: "card" } } }, "en");
    expect(card.fields(m).phone).toContain("+237 6 00 00 00 00");
    expect(card.body(m, {})).toContain("person-title-row");
  });
});

describe("teamOf: which mailboxes sign as a team, and with what label", () => {
  const shared = {
    kind: "SHARED", label_en: "General Enquiries", label_fr: "Renseignements généraux",
    department: null, display_name: "Smart LS", catalogue_department: null,
  };
  const person = { employee_full_name: "Marie Nguema", user_full_name: "marie" };

  test("a PERSONAL mailbox is not a team render", () => {
    expect(service.teamOf({ ...shared, kind: "PERSONAL" }, { language: "en", signAs: "TEAM", person })).toBeNull();
  });

  test("a DELEGATED mailbox is not a team render either", () => {
    expect(service.teamOf({ ...shared, kind: "DELEGATED" }, { language: "en", signAs: "TEAM", person })).toBeNull();
  });

  test("a system render is never a team render", () => {
    expect(service.teamOf(shared, { system: true, language: "en", signAs: "TEAM", person })).toBeNull();
  });

  test("the catalogue label, in the message's language", () => {
    expect(service.teamOf(shared, { language: "en", person }).label).toBe("General Enquiries");
    expect(service.teamOf(shared, { language: "fr", person }).label).toBe("Renseignements généraux");
  });

  test("TEAM (and anything unrecognised) names nobody; TEAM_AND_ME names the sender", () => {
    expect(service.teamOf(shared, { language: "en", signAs: "TEAM", person }).signed_by).toBeNull();
    expect(service.teamOf(shared, { language: "en", signAs: "bogus", person }).signed_by).toBeNull();
    expect(service.teamOf(shared, { language: "en", signAs: undefined, person }).signed_by).toBeNull();
    expect(service.teamOf(shared, { language: "en", signAs: "TEAM_AND_ME", person }).signed_by).toBe("Marie Nguema");
  });

  test("no catalogue entry: the mailbox's department, then its display name", () => {
    const free = { kind: "SHARED", department: "Finance", display_name: "Accounts" };
    expect(service.teamOf(free, { language: "en", person }).label).toBe("Finance");
    expect(service.teamOf({ ...free, department: null }, { language: "en", person }).label).toBe("Accounts");
    expect(service.teamOf({ kind: "SHARED" }, { language: "en", person }).label).toBeNull();
  });
});

describe("resolveFor: the send path", () => {
  const SHARED_CONN = {
    email_address: "info@smartlogistics.cm", display_name: "Smart LS", kind: "SHARED",
    department: null, label_en: "General Enquiries", label_fr: "Renseignements généraux",
    catalogue_department: null,
  };
  const PERSON = {
    user_id: "u1", user_full_name: "marie", employee_full_name: "Marie Nguema",
    job_title: "Operations Officer", department: "Operations", entity_id: "e1",
    employee_phone_mobile: "+237 6 99 99 99 99",
  };
  let put;
  let defaultTemplate;
  let getTemplate;

  function client(conn) {
    return { query: jest.fn(async (sql) => (/FROM email_connection/.test(sql) ? { rows: conn ? [conn] : [] } : { rows: [] })) };
  }

  beforeEach(() => {
    jest.spyOn(repo, "loadPerson").mockResolvedValue(PERSON);
    jest.spyOn(repo, "getProfile").mockResolvedValue({ ...profile, is_enabled: false, signature_template_id: "tpl-personal" });
    jest.spyOn(repo, "loadEntity").mockResolvedValue({ ...entity, entity_id: "e1" });
    jest.spyOn(repo, "loadBranding").mockResolvedValue({});
    jest.spyOn(repo, "getCached").mockResolvedValue(null);
    put = jest.spyOn(repo, "putCached").mockResolvedValue({});
    defaultTemplate = jest.spyOn(repo, "defaultTemplate").mockResolvedValue({ ...template, signature_template_id: "tpl-default" });
    getTemplate = jest.spyOn(repo, "getTemplate").mockResolvedValue({ ...template, signature_template_id: "tpl-personal", is_active: true });
    jest.spyOn(brandLogo, "entityLogo").mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  test("a shared mailbox signs as the team even when the sender switched their own signature off", async () => {
    const r = await service.resolveFor(client(SHARED_CONN), { userId: "u1", connectionId: "c1", language: "en" });
    expect(r.disabled).toBeUndefined();
    expect(r.text).toContain("General Enquiries");
    for (const bit of PERSONAL_BITS) expect(r.html).not.toContain(bit);
  });

  test("the team render uses the company template, not the sender's personal pick", async () => {
    const r = await service.resolveFor(client(SHARED_CONN), { userId: "u1", connectionId: "c1", language: "en" });
    expect(getTemplate).not.toHaveBeenCalled();
    expect(defaultTemplate).toHaveBeenCalledWith(expect.anything(), { department: null, entityId: "e1" });
    expect(r.model.template_id).toBe("tpl-default");
  });

  test("TEAM_AND_ME adds the sender's name and nothing else of theirs", async () => {
    const r = await service.resolveFor(client(SHARED_CONN), {
      userId: "u1", connectionId: "c1", language: "en", signAs: "TEAM_AND_ME",
    });
    expect(r.text).toContain("Sent by Marie Nguema");
    expect(r.html).not.toContain("+237 6 99 99 99 99");
    expect(r.html).not.toContain("Operations Officer");
  });

  test("team renders are cached apart from the person's own signature, per choice", async () => {
    await service.resolveFor(client(SHARED_CONN), { userId: "u1", connectionId: "c1", language: "en" });
    await service.resolveFor(client(SHARED_CONN), { userId: "u1", connectionId: "c1", language: "en", signAs: "TEAM_AND_ME" });
    const rows = put.mock.calls.map((c) => c[1]);
    expect(rows[0]).toMatchObject({ user_id: null, identity_key: "team:c1:u1:team" });
    expect(rows[1]).toMatchObject({ user_id: null, identity_key: "team:c1:u1:me" });
  });

  test("a personal mailbox keeps the personal signature, and honours switching it off", async () => {
    const personal = { ...SHARED_CONN, kind: "PERSONAL", email_address: "marie@smartlogistics.cm" };
    const off = await service.resolveFor(client(personal), { userId: "u1", connectionId: "c1", language: "en" });
    expect(off.disabled).toBe(true);

    repo.getProfile.mockResolvedValue({ ...profile, is_enabled: true });
    const on = await service.resolveFor(client(personal), { userId: "u1", connectionId: "c1", language: "en" });
    expect(on.text).toContain("Marie Nguema");
    expect(on.text).toContain("+237 6 00 00 00 00");
    expect(put.mock.calls.at(-1)[1]).toMatchObject({ user_id: "u1", identity_key: null });
  });
});

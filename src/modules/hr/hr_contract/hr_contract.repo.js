/**
 * HR-contract repository (MOD-12). Factory base + a bespoke joined/filtered list
 * (employee name, filter by employee/status/kind).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "hr_contract", pk: "hr_contract_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
});

module.exports = {
  ...base,

  /** One contract with everything a draft needs: the employee, their entity,
   *  and the vacancy it came from. One query, because the drafter is called
   *  outside a transaction and should not hold a connection across three.
   *
   *  Deliberately NARROW. This is what the AI refiner is shown, and a model
   *  that is rephrasing one clause about a job has no business being handed a
   *  date of birth, a parent's name and a national identity number. The full
   *  civil identity is loaded by `composition()` below, which never leaves the
   *  process. */
  async context(client, id) {
    const { rows } = await client.query(
      `SELECT hc.*, e.full_name AS employee_name, e.department, e.job_title AS employee_job_title,
              e.base_salary, e.hired_on,
              -- country_code, not country: 0100 named it that, and 0515 built
              -- payroll_country / incorporation_country on top of it. The alias
              -- stays entity_country -- hr_contract.draft prints it beside the
              -- employer name, and a two-letter code is what that line has
              -- always shown.
              ce.legal_name AS entity_name, ce.country_code AS entity_country,
              v.title AS vacancy_title
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
         LEFT JOIN corporate_entity ce ON ce.entity_id = coalesce(hc.entity_id, e.entity_id)
         LEFT JOIN vacancy v ON v.vacancy_id = hc.vacancy_id
        WHERE hc.hr_contract_id = $1`,
      [id],
    );
    return rows[0] || null;
  },

  /**
   * Everything a composed contract states, in one read.
   *
   * ── WHY THIS IS NOT `context()` WITH MORE COLUMNS ─────────────────────────
   *
   * `context()` feeds the model. This feeds the composer. Widening the first
   * into the second would have put an employee's parents, birthplace and CNI
   * number into an outbound prompt to satisfy a clause the model never sees —
   * the composer fills the identification paragraph itself, deterministically,
   * and the model only ever rephrases the duties clause. Two callers with two
   * appetites, so two queries.
   *
   * ── THE REPRESENTATIVE ────────────────────────────────────────────────────
   *
   * The employer is bound by a named person acting in a stated capacity, and
   * that person is a row in the entity's own register of directors, officers
   * and signatories. Picked by `employer_person_id` when the contract names
   * one; otherwise the register's own precedence — the legal representative
   * first, then an authorised signatory, then a director or officer — and only
   * among rows that are ACTIVE and whose mandate covers today. A resigned
   * director must not be offered as the person who signs.
   *
   * ── THE ADDRESS COMES FROM entity_address, NOT FROM corporate_entity ──────
   *
   * The preamble names the registered office, the PO box and the country, and
   * `corporate_entity` HAS NO `po_box` COLUMN — 0515 moved the structured
   * address to `entity_address`, leaving `corporate_entity.address` as a legacy
   * free-text line. Read off the entity row alone, `entity.po_box` could never
   * resolve for anybody, and every contract would have refused naming a fact
   * the operator had no field to fill. Found by composing against a real
   * database; nothing static could see it.
   *
   * The precedence is the letterhead's, deliberately — REGISTERED, then the
   * primary row, then whatever is active, then the legacy column (see
   * `entity-letterhead.service.addressLines`). A contract naming a different
   * office from the letterhead at the top of the same page would be its own
   * kind of defect.
   */
  async composition(client, id, { employerPersonId = null } = {}) {
    const { rows } = await client.query(
      `SELECT hc.*,
              to_jsonb(e.*)  AS employee,
              -- The structured address, merged over the entity's own columns:
              -- only entity_address carries a PO box, and the preamble prints
              -- one. See the header.
              to_jsonb(ce.*) || jsonb_strip_nulls(jsonb_build_object(
                'address', COALESCE(NULLIF(btrim(concat_ws(', ', addr.line1, addr.line2)), ''), ce.address),
                'po_box',  addr.po_box,
                'city',    addr.city
              )) AS entity,
              to_jsonb(rep.*) AS representative,
              v.title AS vacancy_title,
              COALESCE(al.lines, '[]'::jsonb) AS allowances
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
         LEFT JOIN corporate_entity ce ON ce.entity_id = COALESCE(hc.entity_id, e.entity_id)
         LEFT JOIN LATERAL (
           SELECT a.line1, a.line2, a.city, a.po_box
             FROM entity_address a
            WHERE a.entity_id = ce.entity_id AND a.is_active
            ORDER BY (a.type = 'REGISTERED') DESC, a.is_primary DESC, a.created_at
            LIMIT 1
         ) addr ON true
         LEFT JOIN LATERAL (
           SELECT p.*
             FROM entity_person p
            WHERE p.entity_id = ce.entity_id
              AND p.holder_type = 'PERSON'
              AND p.is_active
              AND (p.effective_from IS NULL OR p.effective_from <= CURRENT_DATE)
              AND (p.effective_to   IS NULL OR p.effective_to   >= CURRENT_DATE)
              -- $2 is the signatory the WIZARD is holding but has not saved.
              -- Without it, choosing a different director and pressing Compose
              -- produced a contract naming the old one: the picker changed
              -- nothing until after the composition it was meant to change.
              AND (COALESCE($2::uuid, hc.employer_person_id) IS NULL
                   OR p.person_id = COALESCE($2::uuid, hc.employer_person_id))
              AND p.role IN ('LEGAL_REPRESENTATIVE','AUTHORISED_SIGNATORY','DIRECTOR','OFFICER')
            ORDER BY
              -- An explicit choice always wins; the precedence below only
              -- decides who is offered when the contract named nobody.
              (p.person_id = COALESCE($2::uuid, hc.employer_person_id)) DESC NULLS LAST,
              CASE p.role WHEN 'LEGAL_REPRESENTATIVE' THEN 1
                          WHEN 'AUTHORISED_SIGNATORY' THEN 2
                          WHEN 'DIRECTOR' THEN 3 ELSE 4 END,
              p.created_at
            LIMIT 1
         ) rep ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at) AS lines
             FROM employee_allowance a
            WHERE a.employee_id = e.employee_id
              -- Live on the day the contract takes effect, not today: a
              -- contract effective next month states the pay that will then
              -- apply, and a backdated one states the pay that did.
              AND (a.effective_on IS NULL
                   OR a.effective_on <= COALESCE(hc.effective_on, CURRENT_DATE))
              AND (a.ends_on IS NULL
                   OR a.ends_on >= COALESCE(hc.effective_on, CURRENT_DATE))
              AND a.periodicity = 'MONTHLY'
         ) al ON true
         LEFT JOIN vacancy v ON v.vacancy_id = hc.vacancy_id
        WHERE hc.hr_contract_id = $1`,
      [id, employerPersonId || null],
    );
    return rows[0] || null;
  },

  /**
   * Who this entity can put a contract in front of, for the wizard's picker.
   * Same filter as the LATERAL above, so what the wizard offers is exactly what
   * composition would resolve.
   */
  async signatories(client, entityId) {
    const { rows } = await client.query(
      `SELECT person_id, full_name, title, role
         FROM entity_person
        WHERE entity_id = $1
          AND holder_type = 'PERSON'
          AND is_active
          AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
          AND (effective_to   IS NULL OR effective_to   >= CURRENT_DATE)
          AND role IN ('LEGAL_REPRESENTATIVE','AUTHORISED_SIGNATORY','DIRECTOR','OFFICER')
        ORDER BY CASE role WHEN 'LEGAL_REPRESENTATIVE' THEN 1
                           WHEN 'AUTHORISED_SIGNATORY' THEN 2
                           WHEN 'DIRECTOR' THEN 3 ELSE 4 END, full_name`,
      [entityId],
    );
    return rows;
  },

  /** The handbook, by title. Titles only — see hr_contract.draft for why. */
  async sopTitles(client) {
    const { rows } = await client.query(
      "SELECT title FROM sop_document WHERE is_active ORDER BY title LIMIT 12",
    );
    return rows.map((r) => r.title);
  },

  /**
   * Contracts whose term or probation lapses within `days`.
   *
   * ISSUED and SIGNED only: a DRAFT has not been given to anybody, and an ENDED
   * one has already lapsed. `already` excludes the ones an event was emitted
   * for inside the same window, so a daily watcher warns once per contract per
   * window rather than every morning until somebody acts.
   */
  async lapsingWithin(client, { days = 30, kind = "expiry" } = {}) {
    const column = kind === "probation" ? "probation_ends_on" : "end_on";
    const eventKey = kind === "probation" ? "hr_contract.probation_ending" : "hr_contract.expiring";
    const { rows } = await client.query(
      `SELECT hc.hr_contract_id, hc.employee_id, hc.kind, hc.status, hc.effective_on,
              hc.end_on, hc.probation_ends_on, hc.title, e.full_name AS employee_name,
              (hc.${column} - CURRENT_DATE)::int AS days_left
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
        WHERE hc.status IN ('ISSUED','SIGNED')
          AND hc.${column} IS NOT NULL
          AND hc.${column} >= CURRENT_DATE
          AND hc.${column} <= CURRENT_DATE + ($1 || ' days')::interval
          AND NOT EXISTS (
            SELECT 1 FROM event_log o
             WHERE o.entity_ref = 'hr_contract:' || hc.hr_contract_id
               AND o.event_type_key = $2
               AND o.created_at > now() - ($1 || ' days')::interval
          )
        ORDER BY hc.${column}`,
      [String(days), eventKey],
    );
    return rows;
  },
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("hc.employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("hc.status = $" + params.length); }
    if (q.kind) { params.push(q.kind); wh.push("hc.kind = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT hc.*, e.full_name AS employee_name
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
         ${where}
        ORDER BY hc.effective_on DESC NULLS LAST, hc.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  /**
   * The corporate entity a contract numbers under. `hr_contract.entity_id` is
   * nullable and older rows leave it unset, so fall back to the employee's —
   * the same COALESCE the document template already does when it resolves the
   * letterhead. Returns null when neither has one, and the caller then issues
   * without a number rather than failing the transition.
   */
  async entityIdFor(client, { contractId, employeeId }) {
    const { rows } = await client.query(
      `SELECT COALESCE(hc.entity_id, e.entity_id) AS entity_id
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
        WHERE hc.hr_contract_id = $1 AND ($2::uuid IS NULL OR hc.employee_id = $2)`,
      [contractId, employeeId || null],
    );
    return (rows[0] && rows[0].entity_id) || null;
  },
};

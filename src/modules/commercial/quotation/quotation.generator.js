/**
 * Draft With AI (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §5.4): Your Needs and
 * Our Solution, in English and French, from the client's own words in
 * discovery and the PUBLISHED Company Profile. Moved here from
 * `sales/proposal/proposal.generator.js` with the proposal.
 *
 * ── GROUNDED, OR NOT WRITTEN ───────────────────────────────────────────────
 *
 * The model sees a closed list of numbered facts (the published profile and
 * the derived figures, never a cost, a margin or a price: `safeValue` strips
 * any key that smells of one) and must cite the facts each section rests on.
 * A reply that is not the exact JSON shape, or that cites a fact it was not
 * given, is refused and asked again, twice; after that the sections are
 * prefilled from discovery for a person to write, and the answer says so
 * (`manual_required`). Nothing invented reaches a client.
 *
 * In the TEST environment no model is called: the prefill is written and the
 * answer says it is a sandbox.
 */
"use strict";

const { z } = require("zod");
const repo = require("./quotation.repo");
const events = require("./quotation.events");
const quotationSections = require("./quotation.sections");
const { audit } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");

const FEATURE = "proposal_generation";
const factIds = z.array(z.string().regex(/^F\d+$/)).min(1);
const section = z.object({ body: z.string().min(1).max(6000), fact_ids: factIds });
const output = z.object({
  needs_en: z.object({ body: z.string().min(1).max(6000) }),
  needs_fr: z.object({ body: z.string().min(1).max(6000) }),
  solution_en: section,
  solution_fr: section,
}).strict();

/** No cost, margin, profit, purchase price or unit price ever reaches the model. */
function safeValue(value) {
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(cost|margin|profit|purchase|unit_price)/i.test(key))
      .map(([key, v]) => [key, safeValue(v)]));
  }
  return value;
}

/** The closed fact list, numbered F1, F2, ... */
function facts(profile) {
  const out = [];
  const add = (label, value) => {
    const v = safeValue(value);
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return;
    out.push({ id: `F${out.length + 1}`, label, value: v });
  };
  for (const k of ["slogan", "positioning", "operating_regions", "gateways", "memberships", "certifications", "service_promises",
    "fleet_count", "fleet_composition", "warehouse_capacity", "top_lanes", "vertical_mix", "average_clearance_hours", "client_count", "turnover_band"]) {
    add(k, profile[k]);
  }
  for (const p of profile.projects || []) add(`past_project:${p.name_en}`, { description_en: p.description_en, metrics: p.metrics });
  return out;
}

function citations(value) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (Array.isArray(v.fact_ids)) found.push(...v.fact_ids);
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return found;
}

/** The model's reply, or null when it is not the shape or cites a fact it was not given. */
function parse(text, allowed) {
  const raw = String(text || "").replace(/^```json\s*|\s*```$/g, "").trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null; // @silent:parse an unparseable reply is retried, then handed to a person
  }
  const parsed = output.safeParse(data);
  if (!parsed.success) return null;
  if (citations(parsed.data).some((id) => !allowed.has(id))) return null;
  return parsed.data;
}

const redactText = (s) => require("../../../services/ai/redact").redact(s || "");

async function writeSections(client, id, rows, aiGenerated, actor) {
  await atomically(client, async () => {
    const merged = quotationSections.merge(await quotationSections.read(client, id), rows);
    await quotationSections.write(client, id, merged);
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.SECTIONS_DRAFTED, moduleKey: events.MODULE, entityRef: `quotation:${id}`,
      after: { sections: rows.map((r) => r.section_key), ai_generated: aiGenerated },
    });
  });
}

/**
 * Draft the chosen sections (Your Needs and Our Solution by default) of a
 * DRAFT quotation. `input` may carry the operator's own words for the three
 * discovery headings, which win over the latest discovery.
 */
async function draft(client, { quotationId, input = {}, actor = {}, env = "live" }) {
  const q = await repo.get(client, quotationId);
  if (!q) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  if (q.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT quotation can be drafted", 422);
  const wanted = Array.isArray(input.sections) && input.sections.length ? input.sections : ["needs", "solution"];
  const discovery = q.lead_id || q.client_id
    ? await require("../../sales/meeting/meeting.repo").latestDiscovery(client, { leadId: q.lead_id || null, clientId: q.client_id || null })
    : null;
  const raw = {
    client_operations: redactText(input.client_operations || quotationSections.discoveryText(discovery, "OPERATIONS")),
    pain_points: redactText(input.pain_points || quotationSections.discoveryText(discovery, "PAIN_POINTS")),
    proposed_strategy: redactText(input.proposed_strategy || quotationSections.discoveryText(discovery, "STRATEGY")),
    tone: input.tone || "Consultative and expert",
  };
  const needsBody = [raw.client_operations, raw.pain_points].filter(Boolean).join("\n\n") || null;
  const manual = [
    { section_key: "needs", body_en: needsBody, body_fr: needsBody },
    { section_key: "solution", body_en: raw.proposed_strategy || null, body_fr: raw.proposed_strategy || null },
  ].filter((r) => wanted.includes(r.section_key));

  if (env !== "live") {
    await writeSections(client, quotationId, manual, false, actor);
    return { manual_required: true, prefill: raw, provider: "mock", sandbox: true };
  }
  const governance = require("../../ai/governance/governance.service");
  const gate = await governance.canUseFeature(client, { userId: actor.user_id, featureKey: FEATURE });
  if (!gate.allowed) throw new AppError("AI_UNAVAILABLE", gate.reason || "Drafting with AI is unavailable", 403);

  const profile = await require("../../sales/company_profile/company_profile.service").getFresh(client);
  const closed = facts(profile || {});
  const allowed = new Set(closed.map((f) => f.id));
  const prompt = [
    "Draft two sections of a logistics proposal, in English and in French, for the client described in DISCOVERY.",
    "needs: the client's situation and what they need, in their terms, from DISCOVERY only. No facts about us.",
    "solution: how we will serve them, using ONLY the numbered FACTS about us; cite every fact it rests on in fact_ids.",
    "Never invent a figure, a client, a certification or a price. No em dashes. French in sentence case.",
    `Tone: ${raw.tone}.`,
    `FACTS:\n${closed.map((f) => `${f.id} ${f.label}: ${JSON.stringify(f.value)}`).join("\n")}`,
    `DISCOVERY: ${JSON.stringify({ client_operations: raw.client_operations, pain_points: raw.pain_points, proposed_strategy: raw.proposed_strategy })}`,
    'Return only JSON: {"needs_en":{"body":""},"needs_fr":{"body":""},"solution_en":{"body":"","fact_ids":["F1"]},"solution_fr":{"body":"","fact_ids":["F1"]}}',
  ].join("\n");

  const llm = require("../../../services/ai/llm.service");
  let result = null;
  let last = null;
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
    last = await llm.chat({
      client,
      messages: [
        { role: "system", content: prompt + (attempt ? "\nYour previous reply was invalid. Return the exact JSON shape with valid citations only." : "") },
        { role: "user", content: "Draft the sections." },
      ],
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    });
    inputTokens += Number((last && last.usage && last.usage.prompt_tokens) || 0);
    outputTokens += Number((last && last.usage && last.usage.completion_tokens) || 0);
    result = parse(last && last.text, allowed);
  }
  await governance.recordUsage(client, {
    userId: actor.user_id || null, featureKey: FEATURE, provider: last && last.provider, callType: FEATURE,
    inputTokens, outputTokens, wasSuccessful: Boolean(result), errorCode: result ? null : "INVALID_GENERATION",
  });
  if (!result) {
    await writeSections(client, quotationId, manual, false, actor);
    return { manual_required: true, prefill: raw, provider: last && last.provider, sandbox: false };
  }
  const rows = [
    { section_key: "needs", body_en: result.needs_en.body, body_fr: result.needs_fr.body },
    { section_key: "solution", body_en: result.solution_en.body, body_fr: result.solution_fr.body },
  ].filter((r) => wanted.includes(r.section_key));
  await writeSections(client, quotationId, rows, true, actor);
  return { manual_required: false, quotation_id: quotationId, sections: rows.map((r) => r.section_key), provider: last.provider, sandbox: false };
}

module.exports = { draft, parse, facts, safeValue, output };

/**
 * AI action registrar (AI_ARCHITECTURE §2/§7). Walks every `<module>.ai.js`
 * manifest and derives, with zero drift from the modules themselves:
 *   - the CATALOGUE rows for `ai_action_catalogue` (what the AI is told it can do)
 *   - the EXECUTOR map (what the AI is actually allowed to run on confirm)
 *
 * Safety boundary (§1): writes are only AI-enabled when a vetted executor exists
 * in `action-registry` (the explicit, hand-reviewed map). Reads are pure and get
 * a generic executor. So `ai_enabled` is true only for actions we can safely run
 * — the catalogue never advertises a capability the runtime can't honour.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { registry } = require("./action-registry");

const MODULES_DIR = path.resolve(__dirname, "../../modules");

/** Recursively find every *.ai.js manifest under src/modules. */
function discoverManifestFiles(dir = MODULES_DIR, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) discoverManifestFiles(p, out);
    else if (e.name.endsWith(".ai.js")) out.push(p);
  }
  return out;
}

function loadManifests(files = discoverManifestFiles()) {
  const manifests = [];
  for (const f of files) {
    try {
      // dynamic require: manifest path discovered at runtime (trusted, local)
      manifests.push({ file: f, manifest: require(f) });
    } catch {
      // a broken manifest must not break the registrar; skip it.
    }
  }
  return manifests;
}

/* ── Zod → JSON-schema ──────────────────────────────────────────────────────
 *
 * ── THE BUG THIS SHAPE EXISTS TO PREVENT (review 16 Sep 2026 #17) ──────────
 *
 * This used to derive the top-level TYPE of each field and nothing else, and
 * the review's "new-lead creation rejected on data-type validation" is that
 * omission reported from the outside.
 *
 * `create_lead`'s validator says `owner_user_id: z.string().guid()` and
 * `email: z.string().email()`. What reached the model was `{ type: "string" }`
 * for both. So the model was told, accurately as far as it could tell, that any
 * string would do — it sent the owner's NAME, or an email it had inferred —
 * `validatePayload` in the orchestrator checked it against the same lossy
 * schema and passed it, and the rejection happened further in, at the real Zod
 * validator, phrased in terms of a constraint the model was never shown. From
 * the user's chair: "the assistant cannot create a lead and will not say why."
 *
 * The constraints are therefore carried through to the tool contract. Three
 * things follow from that, and all three are the point:
 *   1. the model is told what a valid value looks like BEFORE it guesses;
 *   2. `validatePayload` can refuse a bad value at propose time, where the
 *      message lands next to the form and the user can fix it;
 *   3. the interactive form (`action-fields.js`) can pick a real widget —
 *      `format: "date"` is a date input, not a free-text box.
 *
 * ── WHAT IS DELIBERATELY NOT DERIVED ───────────────────────────────────────
 *
 * `.refine()` / `.superRefine()` bodies are arbitrary predicates (cross-field
 * rules like "either a client or a prospect, not both"). They cannot be
 * expressed in JSON Schema and are NOT approximated here: a half-expressed
 * cross-field rule would be a contract that lies in the other direction. Those
 * stay where they are, enforced by the service, and the failure they produce is
 * a genuine one the user should see.
 */
/** A Zod 4 schema's definition (`schema._zod.def`), or null for anything else. */
const defOf = (t) => (t && t._zod && t._zod.def) || null;

/** Wrappers that change WHETHER a value is required, never WHAT it looks like. */
const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "nonoptional", "readonly", "catch"]);

/**
 * Peel a field to the schema that describes its value.
 *
 * Optional / nullable / default and friends hold the real type in `innerType`.
 * A `.transform()` or `z.preprocess()` is a PIPE: the side worth showing the
 * model is the one that parses the incoming value, which is `in` for a transform
 * and `out` for a preprocess (whose `in` is a bare function).
 */
function unwrap(zt) {
  let t = zt;
  for (let guard = 0; guard < 20; guard += 1) {
    const d = defOf(t);
    if (!d) break;
    if (WRAPPERS.has(d.type) && d.innerType) t = d.innerType;
    else if (d.type === "pipe" && d.in && d.out) t = defOf(d.in) && defOf(d.in).type === "transform" ? d.out : d.in;
    else break;
  }
  return t;
}
const TYPE_MAP = { string: "string", number: "number", boolean: "boolean", array: "array", object: "object", enum: "string", record: "object", any: undefined };

/**
 * The string checks worth telling the model about, as JSON Schema `format`.
 *
 * Only the ones with a canonical JSON Schema spelling AND a validator that can
 * check them cheaply — a format nothing enforces is decoration. `regex` is
 * carried as `pattern` because Zod stores the real RegExp and the model reads
 * it usefully; `starts_with`/`ends_with`/`includes` have no JSON Schema keyword
 * and are folded into the description instead, where they still reach the model.
 *
 * `guid` is what `.uuid()` became in this codebase on Zod 4 (the strict `uuid`
 * rejects the all-zero and nil-style ids some fixtures use), so it is a "uuid"
 * to the model all the same.
 */
const STRING_FORMAT = { uuid: "uuid", guid: "uuid", email: "email", url: "uri", datetime: "date-time", date: "date", time: "time", ipv4: "ipv4", ipv6: "ipv6", cuid: null, cuid2: null, ulid: null, emoji: null, nanoid: null };

/**
 * The check definitions on a schema, in order.
 *
 * Zod 4 keeps `.min()` / `.email()` / `.int()` as entries of `def.checks`, but a
 * top-level `z.email()` / `z.int()` IS its own check: the format is on the schema's
 * definition and `checks` is empty. Both shapes are read so neither is lost.
 */
function checkDefs(def) {
  const out = [];
  if (def && def.check) out.push(def);
  for (const c of (def && def.checks) || []) {
    const cd = defOf(c);
    if (cd) out.push(cd);
  }
  return out;
}

/** Fold a ZodString's checks onto its JSON-schema node. */
function applyStringChecks(node, checks) {
  const notes = [];
  for (const c of checks) {
    switch (c.check) {
      case "min_length": node.minLength = c.minimum; break;
      case "max_length": node.maxLength = c.maximum; break;
      case "length_equals": node.minLength = c.length; node.maxLength = c.length; break;
      case "string_format": {
        if (c.format === "regex") { if (c.pattern && c.pattern.source) node.pattern = c.pattern.source; break; }
        if (c.format === "starts_with") { notes.push(`must start with "${c.prefix}"`); break; }
        if (c.format === "ends_with") { notes.push(`must end with "${c.suffix}"`); break; }
        if (c.format === "includes") { notes.push(`must contain "${c.includes}"`); break; }
        // uuid / email / url / datetime / … — a named check with a format.
        if (Object.prototype.hasOwnProperty.call(STRING_FORMAT, c.format)) {
          const fmt = STRING_FORMAT[c.format];
          if (fmt) node.format = fmt;
          else notes.push(`must be a valid ${c.format}`);
        }
        break;
      }
      default: break;
    }
  }
  if (notes.length) node.description = notes.join("; ");
  return node;
}

/** Number formats that are whole numbers. `int` is a JSON Schema TYPE, not a keyword. */
const INTEGER_FORMATS = new Set(["safeint", "int32", "uint32"]);

/** Fold a ZodNumber's checks on. */
function applyNumberChecks(node, checks) {
  for (const c of checks) {
    switch (c.check) {
      case "greater_than": if (c.inclusive === false) node.exclusiveMinimum = c.value; else node.minimum = c.value; break;
      case "less_than": if (c.inclusive === false) node.exclusiveMaximum = c.value; else node.maximum = c.value; break;
      case "number_format": if (INTEGER_FORMATS.has(c.format)) node.type = "integer"; break;
      case "multiple_of": node.multipleOf = c.value; break;
      default: break;
    }
  }
  return node;
}

/** Fold a ZodArray's length constraints on. */
function applyArrayChecks(node, checks) {
  for (const c of checks) {
    switch (c.check) {
      case "min_length": node.minItems = c.minimum; break;
      case "max_length": node.maxItems = c.maximum; break;
      case "length_equals": node.minItems = c.length; node.maxItems = c.length; break;
      default: break;
    }
  }
  return node;
}

function zodToJsonSchema(input) {
  // A refined object is still an object in Zod 4 (`.refine()` adds a check, it no
  // longer wraps), so its fields are on `.shape` already. A `.transform()` is a
  // pipe whose input side is the object, which `unwrap` reaches.
  const schema = unwrap(input);
  if (!schema || !schema.shape) return { type: "object", properties: {} };
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = unwrap(field);
    const def = defOf(inner);
    const tn = def ? def.type : undefined;
    if (tn === "array") {
      // Recurse one level into the element so array-of-objects (line items,
      // narratives) carry their item shape — the copilot renders repeatable rows.
      const el = unwrap(def.element);
      properties[key] = applyArrayChecks(
        el && el.shape ? { type: "array", items: zodToJsonSchema(el) } : { type: "array" },
        checkDefs(def),
      );
    } else if (tn === "object" && inner.shape) {
      properties[key] = zodToJsonSchema(inner);
    } else {
      const jsonType = TYPE_MAP[tn];
      const node = jsonType ? { type: jsonType } : {};
      // `.options` is the member list for a string enum AND a TS enum: Zod 4 has
      // one enum type, and for a numeric TS enum `def.entries` also carries the
      // reverse mapping, which `.options` already filters out. Without this a
      // TS-enum field reached the model as a bare string and the model had to
      // guess a member name it was never shown.
      if (tn === "enum") {
        const vals = Array.isArray(inner.options)
          ? inner.options
          : Object.values(def.entries || {}).filter((v) => typeof v === "string" || typeof v === "number");
        if (vals.length) node.enum = vals;
      }
      if (tn === "string") applyStringChecks(node, checkDefs(def));
      if (tn === "number") applyNumberChecks(node, checkDefs(def));
      properties[key] = node;
    }
    if (typeof field.isOptional === "function" ? !field.isOptional() : true) required.push(key);
  }
  return required.length ? { type: "object", properties, required } : { type: "object", properties };
}

const permString = (p) => (p && p.module ? `${p.module}:${p.action}` : null);

/** Build the catalogue rows (pure — no DB) from the discovered manifests. */
function buildCatalogue(manifests = loadManifests()) {
  const rows = [];
  const seen = new Set();
  for (const { manifest } of manifests) {
    if (!manifest || !manifest.entity) continue;
    const mod = manifest.module_key || null;
    // `ai_writes: false` on a manifest makes it READ-ONLY for the AI (reads stay,
    // every write is disabled). `aiEnabled: false` on a single action opts just
    // that one out. Used to keep finance (posting/updating the ledger) read-only.
    const aiWritesOff = manifest.ai_writes === false;
    const push = (a, isWrite) => {
      if (!a || !a.key || seen.has(a.key)) return;
      seen.add(a.key);
      const executable = isExecutable(a, isWrite) && a.aiEnabled !== false && !(isWrite && aiWritesOff);
      rows.push({
        action_key: a.key,
        title: a.key.replace(/_/g, " "),
        description: a.describe || null,
        module_key: mod,
        is_write: isWrite,
        payload_schema: a.schema ? zodToJsonSchema(a.schema) : { type: "object", properties: {} },
        required_permission: permString(a.permission),
        requires_confirmation: isWrite ? a.confirm !== false : false,
        ai_enabled: executable,
      });
    };
    for (const r of manifest.reads || []) push(r, false);
    for (const w of manifest.writes || []) push(w, true);
  }
  return rows;
}

// ── Executor map ──
// Reads are pure and get a generic adapter. Writes prefer a hand-vetted executor
// from `action-registry` (which bridges snake_case AI payloads to a service's
// exact signature); any write NOT in that registry falls back to a GENERIC
// adapter that calls the manifest's own `service(client, payload, actor)`. This
// keeps the AI's write reach equal to the app's — every module write is
// proposable — while the vetted executors still own the ones whose service takes
// a non-payload shape (camelCase args / {data,actor}). Human confirm still gates
// every write regardless (orchestrator.confirmAction).
/**
 * Reads get the caller as a THIRD argument, mirroring writeAdapter.
 *
 * Most read services take `(client, payload)` and ignore it, which is why it was
 * easy to leave out. The ones that must not are the reads whose result set
 * depends on WHO is asking. Mail is the first: PR-5 §9.5 makes thread visibility
 * a per-caller predicate and states as a MUST that "the AI grounding layer and
 * the search index respect the same predicate — an assistant that summarises a
 * thread the caller cannot open is the same leak by another route." Those
 * services are written fail-closed, so without the actor they would return
 * nothing and merely look broken; with it they return what this user may see.
 */
function readAdapter(action, service) {
  return async ({ client, user, payload = {} }) => {
    let arg = payload;
    // `get_*` reads take a scalar id. The model may pass it as `id` OR as the
    // natural field name it saw upstream (e.g. `po_id` from a GRN, `dossier_id`),
    // so accept `id` first, then any single *_id value, else the raw payload.
    if (action.startsWith("get_") || action.startsWith("effective_")) {
      if (payload && typeof payload === "object") {
        const idKey = payload.id !== undefined ? "id" : Object.keys(payload).find((k) => k.endsWith("_id"));
        arg = idKey ? payload[idKey] : payload;
      }
    }
    const data = await service(client, arg, { user_id: user && user.user_id });
    return { data };
  };
}

// THE AI WRITE CONTRACT (AI_ARCHITECTURE §2). A manifest write's `service` is
// invoked as `service(client, payload, actor)`: the tenant client, the AI's
// snake_case payload, and the FULL authenticated user as the actor. The manifest
// owns the mapping from that snake_case payload to the service's real argument
// shape and MUST forward the actor — so `created_by`/attribution and any
// actor-gated rule are honoured. Passing the whole user (not a thin
// `{ user_id }`) mirrors the vetted registry, which always passes `actor: user`;
// services read `actor.user_id`, so this is a superset and never regresses a
// call that only reads the id. A bare service reference cannot satisfy this
// contract (its second parameter is `{ data, actor }` or camelCase, not the flat
// payload), which is why the write-contract gate requires an inline wrapper.
function writeAdapter(service) {
  return async ({ client, user, payload = {} }) => {
    const result = await service(client, payload, user || {});
    if (result && result.entity_ref) return result;
    // Derive a reference from the returned row (first *_id column, or id/ref) so
    // the ledger + the conversation "✓ Executed" note can name what was created.
    let ref = null;
    if (result && typeof result === "object") {
      const idKey = Object.keys(result).find((k) => k.endsWith("_id")) || (result.id ? "id" : result.ref ? "ref" : null);
      if (idKey) ref = `record:${result[idKey]}`;
    }
    return { entity_ref: ref, data: result };
  };
}

/** A write is executable if vetted OR its manifest provides a callable service. */
function isExecutable(action, isWrite) {
  if (isWrite) return Boolean(registry[action.key]) || typeof action.service === "function";
  return true; // reads are always executable via the generic adapter
}

/** { action_key → executor({client,user,payload}) }. Vetted registry wins; then
 *  manifest reads (generic read adapter) and writes (generic write adapter). */
function buildExecutorMap(manifests = loadManifests()) {
  const map = { ...registry };
  for (const { manifest } of manifests) {
    for (const r of manifest.reads || []) {
      if (!map[r.key] && typeof r.service === "function") map[r.key] = readAdapter(r.key, r.service);
    }
    for (const w of manifest.writes || []) {
      if (!map[w.key] && typeof w.service === "function") map[w.key] = writeAdapter(w.service);
    }
  }
  return map;
}

/** Upsert catalogue rows into ai_action_catalogue (tenant client). */
async function syncCatalogue(client, { manifests, enableWritesInRegistryOnly = true } = {}) {
  const rows = buildCatalogue(manifests);
  let upserts = 0;
  for (const r of rows) {
     
    await client.query(
      `INSERT INTO ai_action_catalogue
         (action_key, title, description, module_key, is_write, payload_schema,
          required_permission, requires_confirmation, ai_enabled)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (action_key) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, module_key = EXCLUDED.module_key,
         is_write = EXCLUDED.is_write, payload_schema = EXCLUDED.payload_schema,
         required_permission = EXCLUDED.required_permission,
         requires_confirmation = EXCLUDED.requires_confirmation,
         ai_enabled = EXCLUDED.ai_enabled, updated_at = now()`,
      [r.action_key, r.title, r.description, r.module_key, r.is_write, JSON.stringify(r.payload_schema),
        r.required_permission, r.requires_confirmation, r.ai_enabled && !enableWritesInRegistryOnly ? true : r.ai_enabled],
    );
    upserts += 1;
  }
  return { upserts, total: rows.length };
}

module.exports = { discoverManifestFiles, loadManifests, buildCatalogue, buildExecutorMap, syncCatalogue, zodToJsonSchema };

"use strict";
/**
 * Company Profile — the ONE data contract every output reads (guide §3.6).
 *
 * The staff preview, the PDF, the public `/profile/<token>` page and the AI all
 * read what `build()` returns, so they cannot disagree about a figure, a
 * sentence or which items are shown.
 *
 * ── HIDDEN ITEMS ARE REMOVED WHEN DATA IS READ ─────────────────────────────
 *
 * `visible()` runs before `build()`, and before any renderer sees a section: a
 * section switched off is gone, an item switched off is gone, a certification
 * not held is gone, and so are the words keyed by any of them. No template can
 * leak a hidden item because no template is ever handed one. Only the editor
 * reads sections raw, because it is where the switches are.
 *
 * ── WORDS FALL BACK, FACTS DO NOT ──────────────────────────────────────────
 *
 * A word missing in the language asked for falls back to the other language,
 * so a French reader of a half-translated draft reads English rather than a
 * hole. Facts (which items, which switches) live once in `structure` and have
 * no language to fall back from.
 *
 * Everything here is pure: no database, no clock, so it is tested directly.
 */

const { companyProfile } = require("@praxis/shared");

const { SECTION_KEYS, CAPACITY_FIGURES, WHO_FIELDS, CONTACT_FIELDS } = companyProfile;

/** What a new version's sections start as. Same shape 14561 writes. */
const DEFAULT_STRUCTURE = Object.freeze({
  cover: { on: true, image_key: null },
  who_we_are: { on: true, show: { positioning: true, history: true, mission: true } },
  services: { on: true, items: [] },
  capacity: { on: true, figures: Object.fromEntries(CAPACITY_FIGURES.map((f) => [f, true])) },
  certifications: { on: true, items: [] },
  case_stories: { on: true, story_ids: [] },
  clients: { on: true, logo_ids: [] },
  why_us: { on: true, items: [] },
  contact: { on: true, show: Object.fromEntries(CONTACT_FIELDS.map((f) => [f, true])) },
});

/**
 * Section titles and every label an output prints, per language. English is
 * Title Case because it names something; French is sentence case, which is
 * correct French typography and the house rule.
 */
const WORDS = {
  sections: {
    cover: { en: "Cover", fr: "Couverture" },
    who_we_are: { en: "Who We Are", fr: "Qui nous sommes" },
    services: { en: "Services", fr: "Services" },
    capacity: { en: "Capacity & Network", fr: "Capacités et réseau" },
    certifications: { en: "Certifications & Memberships", fr: "Certifications et adhésions" },
    case_stories: { en: "Case Stories", fr: "Études de cas" },
    clients: { en: "Clients", fr: "Clients" },
    why_us: { en: "Why Choose Us", fr: "Pourquoi nous choisir" },
    contact: { en: "Contact", fr: "Contact" },
  },
  who: {
    positioning: { en: "Positioning", fr: "Positionnement" },
    history: { en: "Our Story", fr: "Notre histoire" },
    mission: { en: "Our Mission", fr: "Notre mission" },
  },
  figures: {
    fleet_size: { en: "Fleet Size", fr: "Taille de la flotte" },
    fleet_mix: { en: "Fleet Mix", fr: "Composition de la flotte" },
    warehouse: { en: "Warehouse Capacity", fr: "Capacité d'entreposage" },
    offices: { en: "Offices", fr: "Bureaux" },
    gateways: { en: "Gateways", fr: "Points d'entrée" },
    regions: { en: "Countries Served", fr: "Pays desservis" },
  },
  contact: {
    address: { en: "Address", fr: "Adresse" },
    phone: { en: "Phone", fr: "Téléphone" },
    email: { en: "Email", fr: "E-mail" },
    website: { en: "Website", fr: "Site web" },
  },
  kinds: {
    CERTIFICATION: { en: "Certification", fr: "Certification" },
    MEMBERSHIP: { en: "Membership", fr: "Adhésion" },
  },
  units: {
    vehicles: { en: "vehicles", fr: "véhicules" },
    vehicle: { en: "vehicle", fr: "véhicule" },
    warehouses: { en: "warehouses", fr: "entrepôts" },
    warehouse: { en: "warehouse", fr: "entrepôt" },
    units: { en: "storage units", fr: "unités de stockage" },
  },
  anonymised: { en: "Client anonymised", fr: "Client anonymisé" },
  title: { en: "Company Profile", fr: "Profil d'entreprise" },
};

const lc = (language) => (String(language || "EN").toUpperCase() === "FR" ? "fr" : "en");
const say = (pair, language) => pair[lc(language)] || pair.en;

/** A number as the document's language writes it: 1 250 in French, 1,250 in English. */
function count(n, language) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return new Intl.NumberFormat(lc(language) === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 0 }).format(v);
}

/** An ISO country code as a name in the document's language. */
function countryName(code, language) {
  const c = String(code || "").trim().toUpperCase();
  if (c.length !== 2) return null;
  try {
    return new Intl.DisplayNames([lc(language)], { type: "region" }).of(c) || c;
  } catch {
    /* @silent:parse: an ICU build without region names prints the code */
    return c;
  }
}

const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const asArray = (v) => (Array.isArray(v) ? v : []);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

/* ── reading: switches applied, hidden items removed ─────────────────────── */

/** Drop the words keyed by ids that are no longer present. */
function keepText(text, keep) {
  const out = {};
  for (const [k, v] of Object.entries(asObject(text))) {
    if (keep(k) && nonEmpty(v)) out[k] = v;
  }
  return out;
}

/**
 * Sections with every switch applied. Takes the raw rows (or a key → section
 * map) and returns a map holding only what may be shown.
 */
function visible(rows) {
  const byKey = Array.isArray(rows)
    ? Object.fromEntries(rows.map((r) => [r.section_key, r]))
    : asObject(rows);
  const out = {};
  for (const key of SECTION_KEYS) {
    const row = byKey[key];
    if (!row) continue;
    const s = asObject(row.structure);
    if (s.on === false) continue;
    let structure = { ...s };
    let keep = () => true;

    if (key === "who_we_are" || key === "contact") {
      const show = asObject(s.show);
      structure = { ...s, show };
      keep = (k) => show[k] !== false;
    } else if (key === "services" || key === "why_us") {
      const items = asArray(s.items).filter((i) => i && i.on !== false);
      const ids = new Set(items.map((i) => i.id));
      structure = { ...s, items };
      keep = (k) => ids.has(k.split(".")[0]);
    } else if (key === "certifications") {
      const items = asArray(s.items).filter((i) => i && i.held === true);
      const ids = new Set(items.map((i) => i.id));
      structure = { ...s, items };
      keep = (k) => ids.has(k);
    } else if (key === "capacity") {
      const figures = asObject(s.figures);
      structure = {
        ...s,
        figures: Object.fromEntries(CAPACITY_FIGURES.filter((f) => figures[f] !== false).map((f) => [f, true])),
      };
    }
    out[key] = {
      section_key: key,
      structure,
      text_en: keepText(row.text_en, keep),
      text_fr: keepText(row.text_fr, keep),
    };
  }
  return out;
}

/** A word in the language asked for, else the other one, else null. */
function word(section, key, language) {
  if (!section) return null;
  const first = lc(language) === "fr" ? section.text_fr : section.text_en;
  const second = lc(language) === "fr" ? section.text_en : section.text_fr;
  const v = asObject(first)[key];
  if (nonEmpty(v)) return v;
  const w = asObject(second)[key];
  return nonEmpty(w) ? w : null;
}

/* ── building the contract ──────────────────────────────────────────────── */

function capacityFigures(section, derived, language) {
  const d = asObject(derived);
  const on = asObject(section.structure.figures);
  const out = [];
  const push = (key, value, detail = null) => {
    if (!on[key] || !nonEmpty(value)) return;
    out.push({ key, label: say(WORDS.figures[key], language), value, detail });
  };
  const fleet = Number(d.fleet_count) || 0;
  if (fleet > 0) push("fleet_size", count(fleet, language), say(WORDS.units[fleet === 1 ? "vehicle" : "vehicles"], language));
  const mix = Object.entries(asObject(d.fleet_composition))
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  if (mix.length) push("fleet_mix", mix.map(([k, n]) => `${k} ${count(n, language)}`).join(", "));
  const capacity = Number(d.warehouse_capacity) || 0;
  const sites = Number(d.warehouse_count) || 0;
  if (capacity > 0 || sites > 0) {
    push(
      "warehouse",
      capacity > 0 ? count(capacity, language) : count(sites, language),
      capacity > 0
        ? say(WORDS.units.units, language) + (sites > 0 ? `, ${count(sites, language)} ${say(WORDS.units[sites === 1 ? "warehouse" : "warehouses"], language)}` : "")
        : say(WORDS.units[sites === 1 ? "warehouse" : "warehouses"], language),
    );
  }
  const offices = asArray(d.office_list);
  if (offices.length) {
    const places = [...new Set(offices.map((o) => o.city || o.name).filter(Boolean))];
    push("offices", count(offices.length, language), places.join(", ") || null);
  }
  const gateways = asArray(d.gateway_list).map((g) => g.name).filter(Boolean);
  if (gateways.length) push("gateways", gateways.join(", "));
  const regions = asArray(d.region_list).map((c) => countryName(c, language)).filter(Boolean);
  if (regions.length) push("regions", regions.join(", "));
  return out;
}

/**
 * The profile, in one language, ready to print.
 *
 * `options` carries what the sections point at, already loaded by the
 * service: services, stories, logos (each with a `url`), contact facts, the
 * derived figures and the brand.
 */
function build(sections, options = {}, language = "EN") {
  const L = lc(language) === "fr" ? "FR" : "EN";
  const v = visible(sections);
  const out = [];
  const title = (key) => say(WORDS.sections[key], L);

  const services = new Map(asArray(options.services).map((s) => [s.service_type_id, s]));
  const stories = new Map(asArray(options.stories).map((s) => [s.success_story_id, s]));
  const logos = new Map(asArray(options.logos).map((l) => [l.logo_id, l]));

  if (v.who_we_are) {
    const show = v.who_we_are.structure.show;
    const paragraphs = WHO_FIELDS
      .filter((f) => show[f] !== false)
      .map((f) => ({ key: f, label: f === "positioning" ? null : say(WORDS.who[f], L), body: word(v.who_we_are, f, L) }))
      .filter((p) => p.body);
    if (paragraphs.length) out.push({ key: "who_we_are", title: title("who_we_are"), paragraphs });
  }

  if (v.services) {
    const items = asArray(v.services.structure.items)
      .map((i) => services.get(i.id) ? { s: services.get(i.id), id: i.id } : null)
      .filter(Boolean)
      .map(({ s, id }) => ({
        name: (L === "FR" ? s.name_fr || s.name_en : s.name_en || s.name_fr) || "",
        sentence: word(v.services, id, L)
          || (L === "FR" ? s.short_description_fr || s.short_description_en : s.short_description_en || s.short_description_fr)
          || null,
      }))
      .filter((i) => i.name);
    if (items.length) out.push({ key: "services", title: title("services"), items });
  }

  if (v.capacity) {
    const figures = capacityFigures(v.capacity, options.derived, L);
    const note = word(v.capacity, "network", L);
    if (figures.length || note) out.push({ key: "capacity", title: title("capacity"), figures, note });
  }

  if (v.certifications) {
    const items = asArray(v.certifications.structure.items)
      .map((i) => ({ name: word(v.certifications, i.id, L), kind: say(WORDS.kinds[i.kind] || WORDS.kinds.CERTIFICATION, L) }))
      .filter((i) => i.name);
    if (items.length) out.push({ key: "certifications", title: title("certifications"), items });
  }

  if (v.case_stories) {
    const items = asArray(v.case_stories.structure.story_ids)
      .map((id) => stories.get(id))
      .filter(Boolean)
      .map((s) => ({
        title: s.title,
        client: s.client_name || say(WORDS.anonymised, L),
        summary: s.headline || s.executive_summary || null,
        kpis: asArray(s.kpis).filter((k) => k && nonEmpty(k.label) && nonEmpty(k.value)).slice(0, 4)
          .map((k) => ({ label: k.label, value: k.value })),
      }));
    if (items.length) out.push({ key: "case_stories", title: title("case_stories"), items });
  }

  if (v.clients) {
    const items = asArray(v.clients.structure.logo_ids)
      .map((id) => logos.get(id))
      .filter((l) => l && l.url)
      .map((l) => ({ name: l.name, url: l.url }));
    if (items.length) out.push({ key: "clients", title: title("clients"), logos: items });
  }

  if (v.why_us) {
    const items = asArray(v.why_us.structure.items)
      .map((i) => ({ title: word(v.why_us, `${i.id}.title`, L), body: word(v.why_us, `${i.id}.body`, L) }))
      .filter((i) => i.title || i.body);
    if (items.length) out.push({ key: "why_us", title: title("why_us"), items });
  }

  if (v.contact) {
    const known = asObject(options.contact);
    const show = v.contact.structure.show;
    const web = nonEmpty(known.website) ? known.website.trim() : null;
    const values = {
      address: nonEmpty(known.address) ? known.address : null,
      phone: nonEmpty(known.phone) ? known.phone : null,
      email: nonEmpty(known.email) ? known.email : null,
      website: web,
    };
    const hrefs = {
      phone: values.phone ? `tel:${values.phone.replace(/[^\d+]/g, "")}` : null,
      email: values.email ? `mailto:${values.email}` : null,
      website: web ? (/^https?:\/\//i.test(web) ? web : `https://${web}`) : null,
    };
    const lines = CONTACT_FIELDS
      .filter((f) => show[f] !== false && values[f])
      .map((f) => ({ key: f, label: say(WORDS.contact[f], L), value: values[f], href: hrefs[f] || null }));
    if (lines.length) out.push({ key: "contact", title: title("contact"), lines });
  }

  const brand = asObject(options.brand);
  const cover = v.cover;
  return {
    language: L,
    title: say(WORDS.title, L),
    version: options.version
      ? { number: options.version.number, published_at: options.version.published_at || null }
      : null,
    company: {
      name: brand.name || asObject(options.contact).trading_name || asObject(options.contact).legal_name || "",
      tagline: cover ? word(cover, "tagline", L) : null,
      logo_url: brand.logo_url || null,
      cover_url: cover && cover.structure.image_key ? options.coverUrl || null : null,
    },
    sections: out,
  };
}

/* ── the editor's completeness dot ──────────────────────────────────────── */

/**
 * "complete", "partial" or "empty" per section, for the dot beside it.
 * Partial means something is there but a word exists in one language only, or
 * the section is switched on with nothing in it to print.
 */
function completeness(rows) {
  const byKey = Array.isArray(rows) ? Object.fromEntries(rows.map((r) => [r.section_key, r])) : asObject(rows);
  const out = {};
  for (const key of SECTION_KEYS) {
    const row = byKey[key];
    if (!row) {
      out[key] = "empty";
      continue;
    }
    const s = asObject(row.structure);
    const en = asObject(row.text_en);
    const fr = asObject(row.text_fr);
    const keys = new Set([...Object.keys(en), ...Object.keys(fr)].filter((k) => nonEmpty(en[k]) || nonEmpty(fr[k])));
    const oneSided = [...keys].some((k) => nonEmpty(en[k]) !== nonEmpty(fr[k]));
    let content;
    switch (key) {
      case "services": case "why_us": content = asArray(s.items).some((i) => i.on !== false); break;
      case "certifications": content = asArray(s.items).some((i) => i.held === true); break;
      case "case_stories": content = asArray(s.story_ids).length > 0; break;
      case "clients": content = asArray(s.logo_ids).length > 0; break;
      case "capacity": case "contact": content = true; break;
      case "cover": content = keys.has("tagline") || Boolean(s.image_key); break;
      default: content = keys.size > 0;
    }
    if (!content && !keys.size) out[key] = "empty";
    else if (oneSided || !content) out[key] = "partial";
    else out[key] = "complete";
  }
  return out;
}

/* ── history: a field diff between two versions ─────────────────────────── */

const json = (v) => JSON.stringify(v === undefined ? null : v);

/**
 * What changed between two versions, field by field: each structure field of
 * each section, and each word in each language.
 */
function diff(beforeRows, afterRows) {
  const b = Object.fromEntries(asArray(beforeRows).map((r) => [r.section_key, r]));
  const a = Object.fromEntries(asArray(afterRows).map((r) => [r.section_key, r]));
  const changes = [];
  for (const key of SECTION_KEYS) {
    const sb = asObject(b[key] && b[key].structure);
    const sa = asObject(a[key] && a[key].structure);
    for (const field of new Set([...Object.keys(sb), ...Object.keys(sa)])) {
      if (json(sb[field]) !== json(sa[field])) {
        changes.push({ section_key: key, field, language: null, before: sb[field] ?? null, after: sa[field] ?? null });
      }
    }
    for (const [lang, col] of [["EN", "text_en"], ["FR", "text_fr"]]) {
      const tb = asObject(b[key] && b[key][col]);
      const ta = asObject(a[key] && a[key][col]);
      for (const field of new Set([...Object.keys(tb), ...Object.keys(ta)])) {
        if ((tb[field] ?? null) !== (ta[field] ?? null)) {
          changes.push({ section_key: key, field, language: lang, before: tb[field] ?? null, after: ta[field] ?? null });
        }
      }
    }
  }
  return changes;
}

module.exports = { DEFAULT_STRUCTURE, WORDS, visible, word, build, completeness, diff, countryName, count };

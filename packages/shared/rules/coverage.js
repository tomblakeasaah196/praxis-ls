"use strict";
/**
 * "Where it operates" — a corporate entity's public coverage rows (meeting 6,
 * register 3.5).
 *
 * ── WHY THIS IS SHARED ─────────────────────────────────────────────────────
 *
 * The coverage was a free two-letter box: the schema took any two letters and
 * the Story tab silently dropped a row whose code was not two characters long.
 * That is how Gabon was saved as GB — the United Kingdom — under a label that
 * says "Libreville". The editor now picks the country from the ISO list, the
 * API refuses anything that is not a real ISO 3166-1 alpha-2 code, and an
 * incomplete row blocks the save with a message instead of vanishing. The
 * Story tab and the API both ask THIS file what a complete row is, so the
 * screen cannot believe a row is savable that the API will refuse.
 *
 * ── FLAGGING WHAT IS ALREADY STORED ────────────────────────────────────────
 *
 * Rows saved before this check are not re-written: an automatic "fix" would
 * have to guess whether the code or the label is the wrong half. `flags`
 * reports, per row, a code that is not a country, and a label that names a
 * place in ANOTHER country (Libreville under GB) — so a person corrects it.
 *
 * The place list is a detection aid, not a gazetteer: the capitals, ports and
 * main cities of the corridors this product serves (CEMAC, the rest of OHADA,
 * and the trade lanes freight actually moves on), plus country names in
 * English (the ISO list) and French. A place it does not know is simply not
 * flagged — never a false refusal, because flags never block a save.
 */

const countries = require("../data/countries");

/** A real ISO 3166-1 alpha-2 code, from the shared list. */
function isCountryCode(code) {
  const c = String(code || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && !!countries.byCode(c);
}

/** Lower-case, accents stripped, anything but letters and digits → one space. */
function norm(s) {
  return ` ${String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * Cities and ports → the country they are in. French and English spellings
 * where they differ. Accents and punctuation do not matter (see `norm`).
 */
const PLACES = {
  CM: ["Lac Tchad", "Lake Chad", "Douala", "Yaoundé", "Kribi", "Limbé", "Limbe", "Garoua", "Bafoussam", "Bamenda", "Ngaoundéré", "Maroua", "Buea", "Bertoua", "Ebolowa", "Edéa", "Nkongsamba", "Kumba"],
  GA: ["Libreville", "Port-Gentil", "Franceville", "Owendo", "Oyem", "Lambaréné", "Moanda", "Mouila"],
  CG: ["Brazzaville", "Pointe-Noire", "Dolisie", "Ouesso"],
  CD: ["Kinshasa", "Matadi", "Lubumbashi", "Boma", "Goma", "Kisangani", "Lac Tanganyika", "Lake Tanganyika"],
  CF: ["Bangui", "Berbérati", "Bouar"],
  TD: ["Lac Tchad", "Lake Chad", "N'Djamena", "Ndjamena", "Moundou", "Abéché", "Sarh"],
  GQ: ["Malabo", "Bata"],
  NG: ["Lac Tchad", "Lake Chad", "Niger Delta", "Delta du Niger", "Lagos", "Abuja", "Port Harcourt", "Kano", "Calabar", "Onne", "Apapa", "Ibadan"],
  BJ: ["Cotonou", "Porto-Novo", "Parakou"],
  TG: ["Lomé"],
  CI: ["Abidjan", "Yamoussoukro", "San-Pédro", "Bouaké"],
  SN: ["Dakar", "Thiès", "Saint-Louis du Sénégal"],
  GH: ["Accra", "Tema", "Takoradi", "Kumasi"],
  BF: ["Ouagadougou", "Bobo-Dioulasso"],
  ML: ["Bamako"],
  NE: ["Lac Tchad", "Lake Chad", "Niamey"],
  GN: ["Conakry"],
  AO: ["Luanda", "Lobito"],
  MA: ["Casablanca", "Tanger", "Tangier", "Tanger Med", "Rabat"],
  ZA: ["Durban", "Johannesburg", "Le Cap", "Cape Town"],
  KE: ["Mombasa", "Nairobi"],
  FR: ["Paris", "Marseille", "Le Havre", "Lyon", "Bordeaux", "Fos-sur-Mer"],
  BE: ["Antwerp", "Anvers", "Antwerpen", "Brussels", "Bruxelles", "Zeebrugge"],
  NL: ["Rotterdam", "Amsterdam"],
  GB: ["London", "Londres", "Felixstowe", "Southampton", "Liverpool", "Manchester", "Birmingham"],
  DE: ["Hamburg", "Hambourg", "Bremen", "Bremerhaven", "Frankfurt", "Francfort", "Berlin"],
  ES: ["Valencia", "Valence", "Algeciras", "Algésiras", "Barcelona", "Barcelone", "Madrid"],
  IT: ["Genoa", "Gênes", "Genova", "Rome", "Milan", "Gioia Tauro"],
  PT: ["Lisbon", "Lisbonne", "Porto", "Sines"],
  CN: ["Shanghai", "Shenzhen", "Ningbo", "Qingdao", "Guangzhou", "Beijing", "Pékin", "Tianjin", "Xiamen", "Yiwu"],
  HK: ["Hong Kong"],
  AE: ["Dubai", "Dubaï", "Jebel Ali", "Abu Dhabi", "Sharjah"],
  TR: ["Istanbul", "Mersin", "Izmir"],
  IN: ["Mumbai", "Bombay", "Nhava Sheva", "Chennai", "Mundra", "New Delhi"],
  US: ["New York", "Houston", "Los Angeles", "Miami", "Savannah", "Baltimore"],
  BR: ["São Paulo", "Rio de Janeiro"],
  JP: ["Tokyo", "Yokohama"],
  KR: ["Busan", "Seoul", "Séoul"],
};

/** Country names a French label uses that the English ISO list does not. */
const FRENCH_NAMES = {
  CM: ["Cameroun"], TD: ["Tchad"], GQ: ["Guinée équatoriale"], CF: ["Centrafrique", "République centrafricaine"],
  CG: ["Congo-Brazzaville", "République du Congo", "Republic of the Congo", "Congo"], CD: ["Congo-Kinshasa", "RDC", "DRC", "République démocratique du Congo", "Democratic Republic of the Congo", "Congo"],
  GB: ["Royaume-Uni", "Angleterre", "Grande-Bretagne", "England", "UK"], DE: ["Allemagne"], ES: ["Espagne"], CN: ["Chine"],
  BE: ["Belgique"], NL: ["Pays-Bas", "Hollande"], IT: ["Italie"], NG: ["Nigéria"], BJ: ["Bénin"],
  CI: ["Côte d'Ivoire", "Ivory Coast"], SN: ["Sénégal"], AE: ["Émirats arabes unis", "UAE", "Emirates"],
  US: ["États-Unis", "USA"], TR: ["Turquie"], IN: ["Inde"], MA: ["Maroc"], ZA: ["Afrique du Sud"],
  GN: ["Guinée"], ML: ["Mali"], NE: ["Niger"], GH: ["Ghana"], AO: ["Angola"], TG: ["Togo"], GA: ["Gabon"],
  JP: ["Japon"], KR: ["Corée du Sud", "South Korea"], BR: ["Brésil"], PT: ["Portugal"],
};

/** The English ISO names, minus the comma/parenthesis forms no label is written in. */
function isoNames() {
  const out = {};
  for (const c of countries.COUNTRIES) {
    if (/[,(]/.test(c.name)) continue;
    (out[c.code] = out[c.code] || []).push(c.name);
  }
  return out;
}

/** Every known name, normalised, longest first — so "Equatorial Guinea" wins over "Guinea". */
const NAMES = (() => {
  const add = (acc, table, kind) => {
    for (const [code, names] of Object.entries(table)) {
      for (const n of names) acc.push({ key: norm(n), name: n, code, kind });
    }
    return acc;
  };
  const all = add(add(add([], PLACES, "place"), FRENCH_NAMES, "country"), isoNames(), "country");
  return all.filter((n) => n.key.trim().length >= 2).sort((a, b) => b.key.length - a.key.length);
})();

/**
 * The known places a label names, each with its country. Longer names claim
 * their text first, so "Guinée équatoriale" is one hit (GQ), not also "Guinée"
 * (GN); and "Congo" alone names both Congos, so it never contradicts either.
 */
function placesIn(label) {
  let text = norm(label);
  const hits = [];
  for (let i = 0; i < NAMES.length; i++) {
    const n = NAMES[i];
    if (!text.includes(n.key)) continue;
    // Every country the same name can mean, before its text is claimed.
    for (const m of NAMES) if (m.key === n.key) hits.push({ name: m.name, code: m.code, kind: m.kind });
    text = text.split(n.key).join(" ");
  }
  return hits;
}

/**
 * What stops a row being saved: no country picked, a code that is not a
 * country, or no label at all (the site prints the label, never our name for
 * the country, so a row with neither has nothing to show). Empty = complete.
 */
function rowProblems(row) {
  const r = row || {};
  const out = [];
  const code = String(r.country_code || "").trim();
  if (!code) out.push("Pick the country.");
  else if (!isCountryCode(code)) out.push(`"${code}" is not a country code — pick the country from the list.`);
  if (!String(r.label_fr || "").trim() && !String(r.label_en || "").trim()) out.push("Give the place a label, in French or English.");
  return out;
}

/**
 * Stored rows that need a person's eye. Never blocks anything, never fixes
 * anything — see the header.
 *
 *   NOT_A_COUNTRY     the code is not an ISO 3166-1 alpha-2 country
 *   PLACE_ELSEWHERE   a label names a place in another country
 */
function flags(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const code = String((row && row.country_code) || "").trim().toUpperCase();
    const label = [row && row.label_fr, row && row.label_en].filter(Boolean).join(" / ");
    if (!isCountryCode(code)) {
      out.push({ index, country_code: code, label, kind: "NOT_A_COUNTRY", message: `"${code || "—"}" is not a country code.` });
      return;
    }
    const hits = [row.label_fr, row.label_en].flatMap((l) => placesIn(l));
    // "Congo" names both Congos: a place only contradicts the row when NONE of
    // the countries that name can mean is the row's.
    const byName = new Map();
    for (const h of hits) {
      const k = norm(h.name);
      if (!byName.has(k)) byName.set(k, { name: h.name, codes: new Set() });
      byName.get(k).codes.add(h.code);
    }
    for (const { name, codes } of byName.values()) {
      if (codes.has(code)) continue;
      const elsewhere = [...codes][0];
      const there = countries.byCode(elsewhere);
      const here = countries.byCode(code);
      out.push({
        index,
        country_code: code,
        label,
        kind: "PLACE_ELSEWHERE",
        place: name,
        place_country: elsewhere,
        message: `"${name}" is in ${there ? there.name : elsewhere}, but this row says ${here ? here.name : code} (${code}).`,
      });
      break;
    }
  });
  return out;
}

exports.isCountryCode = isCountryCode;
exports.placesIn = placesIn;
exports.rowProblems = rowProblems;
exports.flags = flags;
exports.PLACES = PLACES;

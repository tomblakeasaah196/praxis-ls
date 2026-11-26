"use strict";

/**
 * /llms.txt and /llms-full.txt (https://llmstxt.org), per host.
 *
 * What an AI assistant reads to describe the company: the tenant's AI profile
 * (Settings › Website › AI Profile, 14700), written once and plainly, with the
 * site's main pages as links. `/llms-full.txt` adds every published service
 * and article with its summary and address, so an assistant can cite the page
 * rather than paraphrase a guess.
 *
 * ── NOTHING IS INVENTED ─────────────────────────────────────────────────────
 *
 * No profile summary, no file: both answer 404. A file of defaults would be
 * text an assistant repeats as the company's own account of itself, and it
 * would describe somebody else. Every line below is the tenant's own record;
 * the only words this file adds are the section headings, which name what
 * the tenant's text under them is.
 */

const publicHead = require("./public-head");
const shareCopy = require("./public-head-share");
const paths = require("./public-web-paths");
const aiProfile = require("../../modules/site/site_settings/site_ai_profile");

const clean = (v) => String(v || "").replace(/\r\n?/g, "\n").trim();
const oneLine = (v) => clean(v).replace(/\s+/g, " ");
const pick = (...vals) => vals.map((v) => oneLine(v)).find(Boolean) || null;

/** A heading and its text, or nothing when the tenant wrote nothing. */
function section(title, body) {
  const text = Array.isArray(body)
    ? body.filter(Boolean).map((b) => "- " + oneLine(b)).join("\n")
    : clean(body);
  return text ? "## " + title + "\n\n" + text + "\n" : "";
}

/** `- [Title](url): note`, the llms.txt list form. */
const item = (title, url, note) => "- [" + oneLine(title).replace(/[[\]]/g, "") + "](" + url + ")" + (pick(note) ? ": " + pick(note) : "");

/** The ISO day of a date column or timestamp, or null. */
function isoDay(v) {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Everything both files are made from, for one host, or null when the host
 * has no live tenant or the tenant has written no profile.
 */
async function gather(host, { full }) {
  return publicHead.withTenant(host, async (client) => {
    const profile = await aiProfile.published(client);
    if (!profile) return null;
    const branding = await require("../../modules/branding/branding.service").getBranding(client).catch(() => null);
    const share = await shareCopy.load(client).catch(() => shareCopy.empty());
    // The main pages by the names the site's own navigation gives them.
    const nav = (key, fallback) => share.text(key) || fallback;
    const out = {
      profile,
      name: shareCopy.siteName(share, branding),
      labels: {
        about: nav("site.nav.about", "About"),
        services: nav("site.nav.services", "Services"),
        insights: nav("site.nav.insights", "Insights"),
        contact: nav("site.nav.contact", "Contact"),
      },
      services: [],
      articles: [],
    };
    if (full) {
      const repo = require("../../modules/operations/service_type_web/service_type_web.repo");
      out.services = publicHead.serviceRows(await repo.publicList(client).catch(() => []));
      const view = await require("../../modules/content/insight/insight.service")
        .listPublic(client, { page: 1, perPage: 500 })
        .catch(() => null);
      out.articles = (view && view.articles) || [];
    }
    return out;
  });
}

function render(data, origin, base, { full }) {
  const { profile: p, name } = data;
  const at = (rest) => origin + paths.joinBase(base, rest);
  const facts = [
    p.alternate_names.length ? "Also known as: " + p.alternate_names.join(", ") : null,
    p.founded ? "Founded: " + oneLine(p.founded) : null,
    p.areas_served.length ? "Areas served: " + p.areas_served.join(", ") : null,
    p.sectors.length ? "Sectors: " + p.sectors.join(", ") : null,
    "Website: " + at(""),
  ].filter(Boolean);

  const parts = [
    "# " + name,
    "",
    "> " + oneLine(p.summary),
    "",
    facts.map((f) => "- " + f).join("\n"),
    "",
    section("Offices", p.offices),
    section("Services", p.services_summary),
    section("Memberships and Credentials", p.credentials),
    section("Leadership", p.leadership),
    section("What the Company Does Not Do", p.not_offered),
    section("Contact", p.contact),
  ];

  if (full) {
    if (data.services.length) {
      parts.push(section("Service Pages", data.services.map((r) => {
        const slug = r.slug_en || r.slug_fr;
        const title = pick(r.web_name_en, r.name_en, r.web_name_fr, r.name_fr);
        return slug && title ? item(title, at("/services/" + encodeURIComponent(slug)), pick(r.short_description_en, r.short_description_fr)).slice(2) : null;
      })));
    }
    if (data.articles.length) {
      parts.push(section("Articles", data.articles.map((a) => {
        const slug = a.slug_en || a.slug_fr;
        const title = pick(a.title_en, a.title_fr);
        if (!slug || !title) return null;
        const day = isoDay(a.published_at);
        return item(title, at("/insights/" + encodeURIComponent(slug)), [day, pick(a.excerpt_en, a.excerpt_fr)].filter(Boolean).join(". ")).slice(2);
      })));
    }
  } else {
    parts.push(section("Pages", [
      item(data.labels.about, at("/about")).slice(2),
      item(data.labels.services, at("/services")).slice(2),
      item(data.labels.insights, at("/insights")).slice(2),
      item(data.labels.contact, at("/contact")).slice(2),
    ]));
    parts.push(section("Optional", [item("Full profile with every service and article", origin + "/llms-full.txt").slice(2)]));
  }

  const reviewed = isoDay(p.reviewed_on);
  if (reviewed) parts.push("Last reviewed: " + reviewed + "\n");
  return parts.filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** The file's text, or null when there is nothing to publish. */
async function build(host, origin, base, { full = false } = {}) {
  if (publicHead.isNoindexHost(host)) return null;
  const data = await publicHead.memo(host + " " + base + (full ? " llms-full" : " llms"), () => gather(host, { full }));
  return data ? render(data, origin, base, { full }) : null;
}

module.exports = { build, render, section, isoDay };

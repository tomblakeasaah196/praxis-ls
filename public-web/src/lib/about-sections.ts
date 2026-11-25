/**
 * The About page's sections (14660), read in the visitor's language.
 *
 * The server sends them in the shared shape (`siteBrand.aboutSections`) with
 * French already removed for an English-only tenant. This turns them into the
 * flat strings the page draws, and drops whatever is empty, so a section the
 * tenant has not written arrives as an empty list or an empty string and the
 * page leaves it out.
 */
import { pickBilingual, type Bilingualish } from "./site-api";
import type { Lang } from "./i18n";

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, lang: Lang): string =>
  pickBilingual((v && typeof v === "object" ? v : null) as Bilingualish | null, lang).trim();

export type AboutSectionsView = {
  heroEyebrow: string;
  credentials: { label: string; value: string }[];
  story: { title: string; paragraphs: string[] };
  principlesTitle: string;
  message: { leaderId: string | null; title: string; paragraphs: string[] };
  offices: {
    title: string;
    items: { entityId: string; heading: string; label: string; services: string }[];
  };
  sectors: { title: string; items: { title: string; text: string }[]; clientsCaption: string };
  standards: { title: string; text: string };
  closing: { title: string; text: string };
};

export function aboutSections(raw: unknown, lang: Lang): AboutSectionsView {
  const s = obj(raw);
  const story = obj(s.story);
  const message = obj(s.message);
  const offices = obj(s.offices);
  const sectors = obj(s.sectors);
  const standards = obj(s.standards);
  const closing = obj(s.closing);
  return {
    heroEyebrow: text(s.hero_eyebrow, lang),
    credentials: arr(s.credentials)
      .map((c) => ({ label: text(obj(c).label, lang), value: text(obj(c).value, lang) }))
      .filter((c) => c.label && c.value),
    story: {
      title: text(story.title, lang),
      paragraphs: arr(story.paragraphs).map((p) => text(p, lang)).filter(Boolean),
    },
    principlesTitle: text(s.principles_title, lang),
    message: {
      leaderId: typeof message.leader_id === "string" && message.leader_id ? message.leader_id : null,
      title: text(message.title, lang),
      paragraphs: arr(message.paragraphs).map((p) => text(p, lang)).filter(Boolean),
    },
    offices: {
      title: text(offices.title, lang),
      items: arr(offices.items)
        .map((i) => {
          const o = obj(i);
          return {
            entityId: typeof o.entity_id === "string" ? o.entity_id : "",
            heading: text(o.heading, lang),
            label: text(o.label, lang),
            services: text(o.services, lang),
          };
        })
        .filter((o) => o.entityId),
    },
    sectors: {
      title: text(sectors.title, lang),
      items: arr(sectors.items)
        .map((i) => ({ title: text(obj(i).title, lang), text: text(obj(i).text, lang) }))
        .filter((i) => i.title),
      clientsCaption: text(sectors.clients_caption, lang),
    },
    standards: { title: text(standards.title, lang), text: text(standards.text, lang) },
    closing: { title: text(closing.title, lang), text: text(closing.text, lang) },
  };
}

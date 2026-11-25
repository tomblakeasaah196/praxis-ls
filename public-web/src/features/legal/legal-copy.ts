/**
 * The copy for the Impressum, in English and German (`site.legal.*`), EN and FR, kept OUT of
 * `lib/i18n-dict.ts` (PR 4, 14660).
 *
 * `i18n-dict.ts` is in the ENTRY graph, so every string in it is downloaded
 * by every visitor to every page; these are read only on lazy routes, and
 * putting them there took the first paint past its budget. The same move
 * `features/tracking/track-copy.ts` made, with the same two rules:
 *
 *   1. NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS: two object literals
 *      and an `as const`. The catalogue generator and `check-i18n` read this
 *      file as data; the registration is in the `-i18n.ts` file next door.
 *   2. The keys are the dictionary's: a tenant's copy override still
 *      applies, because registration never overwrites.
 */

export const en = {
    impressum: "Impressum",
    privacy: "Privacy policy",
    impressumLead: "Information about the companies that operate this website.",
    company: "Company",
    registeredOffice: "Registered office",
    representedBy: "Represented by",
    register: "Commercial register",
    registerCourt: "Register court",
    vatId: "VAT identification number",
    contact: "Contact",
    phone: "Phone",
    email: "Email",
    website: "Website",
    responsible: "Responsible for content",
    disputes: "Consumer dispute resolution",
    disputesText: "We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.",
    pending: "Details are being added.",
    /* The German version of the Impressum's labels. The Impressum is owed
       in German to a German reader, so these are German in both language
       trees. They are not the interface; they are the legal text itself. */
    de: {
      impressum: "Impressum",
      lead: "Angaben gemäß § 5 DDG",
      company: "Firma",
      registeredOffice: "Sitz",
      representedBy: "Vertreten durch",
      register: "Handelsregister",
      registerCourt: "Registergericht",
      vatId: "Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG",
      contact: "Kontakt",
      phone: "Telefon",
      email: "E-Mail",
      website: "Website",
      responsible: "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV",
      disputes: "Verbraucherstreitbeilegung",
      disputesText: "Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
      pending: "Angaben werden ergänzt.",
    },
} as const;

export const fr = {
    impressum: "Impressum",
    privacy: "Politique de confidentialité",
    impressumLead: "Informations sur les sociétés qui exploitent ce site.",
    company: "Société",
    registeredOffice: "Siège social",
    representedBy: "Représentée par",
    register: "Registre du commerce",
    registerCourt: "Tribunal d’immatriculation",
    vatId: "Numéro de TVA intracommunautaire",
    contact: "Contact",
    phone: "Téléphone",
    email: "E-mail",
    website: "Site web",
    responsible: "Responsable du contenu",
    disputes: "Règlement des litiges de consommation",
    disputesText: "Nous ne sommes ni disposés ni tenus de participer à une procédure de règlement des litiges devant un organisme de médiation de la consommation.",
    pending: "Les informations sont en cours d’ajout.",
    de: {
      impressum: "Impressum",
      lead: "Angaben gemäß § 5 DDG",
      company: "Firma",
      registeredOffice: "Sitz",
      representedBy: "Vertreten durch",
      register: "Handelsregister",
      registerCourt: "Registergericht",
      vatId: "Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG",
      contact: "Kontakt",
      phone: "Telefon",
      email: "E-Mail",
      website: "Website",
      responsible: "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV",
      disputes: "Verbraucherstreitbeilegung",
      disputesText: "Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
      pending: "Angaben werden ergänzt.",
    },
} as const;

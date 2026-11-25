"use strict";
/**
 * The privacy policy's first draft, in English and German, written from the
 * companies the website publishes.
 *
 * ── A DRAFT, FOR A PERSON TO READ ──────────────────────────────────────────
 *
 * `site_brand.service.draftPrivacy` writes this into the DRAFT columns of the
 * `privacy-policy` document. Nothing here reaches the site until an editor has
 * read it and pressed Publish, which is the point: a privacy notice is a legal
 * statement by the tenant, and the product supplies the structure and the
 * facts it already holds (who the companies are, where they sit, how to reach
 * them), never the final word.
 *
 * ── WHAT IT STATES, AND WHY ONLY THAT ──────────────────────────────────────
 *
 * Only what the product itself does: the enquiry, message, quote, tracking,
 * portal and careers flows, the security check, the absence of advertising or
 * analytics cookies, the two pieces of browser storage the site uses. A tenant
 * that adds a tool the product does not ship adds its paragraph by hand.
 */

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"]);

/** One company as the controller paragraph prints it. */
function controllerBlock(e, L) {
  const name = [e.legal_name, e.legal_form && !e.legal_name.includes(e.legal_form) ? e.legal_form : null]
    .filter(has).join(" ");
  const lines = [`**${name}**`, ...e.address_lines];
  const reps = e.representatives.map((r) => r.name).filter(has);
  if (reps.length) lines.push(`${L.represented}: ${reps.join(", ")}`);
  if (has(e.email)) lines.push(`${L.email}: ${e.email}`);
  if (has(e.phone)) lines.push(`${L.phone}: ${e.phone}`);
  return lines.join("  \n");
}

const EN = {
  title: "Privacy Policy",
  summary: "Who is responsible for your personal data when you use this website, what we collect, why, for how long, and the rights you have.",
  represented: "Represented by",
  email: "Email",
  phone: "Phone",
  body: (ctrl, inEu, outsideEu, contact) => `## Who Is Responsible

${ctrl.length > 1
    ? "The following companies are responsible for the personal data processed through this website, each for the enquiries and shipments it handles:"
    : "The following company is responsible for the personal data processed through this website:"}

${ctrl.join("\n\n")}

For any question about your data, write to ${contact}. We do not have a statutory duty to appoint a data protection officer; your message reaches the people who decide how your data is used.

## What We Collect, and Why

**Visiting the website.** Our servers record the address your device connects from, the page asked for, the time, and the browser it was asked by. We use these records to deliver the page, to keep the site secure and to investigate misuse, and we delete them once they are no longer needed for that purpose. The legal basis is our legitimate interest in a secure, working website (Article 6(1)(f) GDPR).

**Messages and enquiries.** When you write to us through the contact form or the message button, we receive what you give us: your email address, your message, and anything else you choose to add, such as your name, company, telephone number and attached documents. We use it to answer you and, where you ask for it, to prepare an offer (Article 6(1)(b) GDPR), and to keep a record of what was agreed (Article 6(1)(f) GDPR). Your email address is kept in your browser for the length of your visit, so you do not have to type it twice; it is erased when you close the browser.

**Quote requests.** A quote request carries the details of your cargo, the places it moves between and how to reach you. We use them to price and plan the shipment (Article 6(1)(b) GDPR).

**Tracking a shipment.** Tracking needs only the file reference. We do not ask who you are, and the reference is not linked to you on this website.

**The client portal.** If you have an account, we process your name, email address and the shipments and documents of the company you work for, to give you access to them under our contract with that company (Article 6(1)(b) and (f) GDPR).

**Applying for a job.** An application carries what you send us, usually your name, contact details, career history and CV. We use it only to consider you for the position, or for future positions if you agree to that (Article 6(1)(b) and (a) GDPR).

**The security check.** Our forms are protected against automated misuse by Cloudflare Turnstile, which assesses signals from your browser to tell a person from a program, without asking you to solve a puzzle. Cloudflare, Inc. processes these signals on our behalf; the legal basis is our legitimate interest in forms that are not flooded with spam (Article 6(1)(f) GDPR).

We use no advertising cookies, no analytics and no tracking across other websites. Apart from the email address mentioned above, the site keeps one setting in your browser: whether you chose the light or the dark display.

## Who Receives Your Data

Our own staff, as far as their work requires it. Service providers who host the website and handle our email, under contracts that bind them to our instructions. And, when you ask us to move goods, the carriers, customs authorities, port operators and agents who must have the data to move them, as far as the shipment needs it. We disclose data to public authorities only where the law obliges us to.

## Transfers Between Europe and Central Africa

${inEu && outsideEu
    ? "We work at both ends of the trade between Europe and Central Africa. When you ask us to move goods between the two, your data travels with the shipment: we transfer it to Cameroon, or from Cameroon to the European Union, where that is necessary to carry out the contract you have asked for (Article 49(1)(b) and (c) GDPR). Cameroon is not covered by an adequacy decision of the European Commission, and data held there is protected by Cameroonian law and by our own controls."
    : "When a shipment requires it, we transfer data to the carriers and agents at its destination, where that is necessary to carry out the contract you have asked for (Article 49(1)(b) and (c) GDPR)."}

## How Long We Keep It

As long as we need it for the purpose it was collected for, and then no longer. Enquiries that lead to no business are deleted once they are no longer needed to answer you. Records of shipments, offers, invoices and correspondence are kept for the periods commercial and tax law require: up to ten years in Germany (section 257 of the Commercial Code and section 147 of the Fiscal Code) and ten years under the OHADA Uniform Act on accounting that applies in Cameroon. Applications are deleted six months after the position is filled, unless you have agreed that we keep yours for longer.

## Your Rights

You may ask us at any time what data we hold about you and receive a copy of it; have it corrected; have it erased or its use restricted; receive it in a format a machine can read; and object to its use where we rely on our legitimate interest. Where you gave consent, you may withdraw it at any time, without affecting what was done before. Write to ${contact}.

You also have the right to complain to a data protection supervisory authority, in particular in the country where you live or work${inEu ? ", or in Germany to the authority responsible for the federal state in which our German company has its registered office" : ""}${outsideEu ? ". In Cameroon, you may address the national authority responsible for the protection of personal data" : ""}.

## Changes to This Policy

We update this policy when what we do with data changes. The version and date at the top tell you which one you are reading.
`,
};

const DE = {
  title: "Datenschutzerklärung",
  summary: "Wer für Ihre personenbezogenen Daten verantwortlich ist, wenn Sie diese Website nutzen, was wir erheben, warum, wie lange, und welche Rechte Sie haben.",
  represented: "Vertreten durch",
  email: "E-Mail",
  phone: "Telefon",
  body: (ctrl, inEu, outsideEu, contact) => `## Verantwortliche

${ctrl.length > 1
    ? "Für die Verarbeitung personenbezogener Daten über diese Website sind die folgenden Unternehmen verantwortlich, jeweils für die Anfragen und Sendungen, die sie bearbeiten:"
    : "Für die Verarbeitung personenbezogener Daten über diese Website ist das folgende Unternehmen verantwortlich:"}

${ctrl.join("\n\n")}

Für alle Fragen zu Ihren Daten schreiben Sie an ${contact}. Wir sind gesetzlich nicht verpflichtet, einen Datenschutzbeauftragten zu benennen; Ihre Nachricht erreicht die Personen, die über die Verwendung Ihrer Daten entscheiden.

## Was Wir Erheben und Warum

**Besuch der Website.** Unsere Server protokollieren die Adresse, von der aus Ihr Gerät sich verbindet, die aufgerufene Seite, den Zeitpunkt und den verwendeten Browser. Wir nutzen diese Protokolle, um die Seite auszuliefern, die Website zu schützen und Missbrauch aufzuklären, und löschen sie, sobald sie dafür nicht mehr erforderlich sind. Rechtsgrundlage ist unser berechtigtes Interesse an einer sicheren, funktionierenden Website (Art. 6 Abs. 1 lit. f DSGVO).

**Nachrichten und Anfragen.** Wenn Sie uns über das Kontaktformular oder die Nachrichtenschaltfläche schreiben, erhalten wir, was Sie uns mitteilen: Ihre E-Mail-Adresse, Ihre Nachricht und alles, was Sie zusätzlich angeben, etwa Name, Unternehmen, Telefonnummer und beigefügte Dokumente. Wir verwenden diese Angaben, um Ihnen zu antworten und auf Ihren Wunsch ein Angebot zu erstellen (Art. 6 Abs. 1 lit. b DSGVO) sowie um festzuhalten, was vereinbart wurde (Art. 6 Abs. 1 lit. f DSGVO). Ihre E-Mail-Adresse wird für die Dauer Ihres Besuchs in Ihrem Browser gespeichert, damit Sie sie nicht zweimal eingeben müssen; sie wird gelöscht, wenn Sie den Browser schließen.

**Angebotsanfragen.** Eine Angebotsanfrage enthält Angaben zu Ihrer Ware, zu Abgangs- und Bestimmungsort und dazu, wie wir Sie erreichen. Wir verwenden sie, um die Sendung zu kalkulieren und zu planen (Art. 6 Abs. 1 lit. b DSGVO).

**Sendungsverfolgung.** Für die Sendungsverfolgung genügt die Vorgangsnummer. Wir fragen nicht, wer Sie sind, und die Nummer wird auf dieser Website nicht mit Ihrer Person verknüpft.

**Das Kundenportal.** Wenn Sie ein Konto haben, verarbeiten wir Ihren Namen, Ihre E-Mail-Adresse sowie die Sendungen und Dokumente des Unternehmens, für das Sie tätig sind, um Ihnen im Rahmen unseres Vertrags mit diesem Unternehmen Zugang dazu zu gewähren (Art. 6 Abs. 1 lit. b und f DSGVO).

**Bewerbungen.** Eine Bewerbung enthält, was Sie uns senden, in der Regel Name, Kontaktdaten, beruflichen Werdegang und Lebenslauf. Wir verwenden sie ausschließlich, um Sie für die Stelle zu berücksichtigen, oder für künftige Stellen, wenn Sie dem zustimmen (Art. 6 Abs. 1 lit. b und a DSGVO).

**Die Sicherheitsprüfung.** Unsere Formulare sind durch Cloudflare Turnstile vor automatisiertem Missbrauch geschützt. Der Dienst wertet Signale Ihres Browsers aus, um einen Menschen von einem Programm zu unterscheiden, ohne dass Sie ein Rätsel lösen müssen. Cloudflare, Inc. verarbeitet diese Signale in unserem Auftrag; Rechtsgrundlage ist unser berechtigtes Interesse an Formularen, die nicht mit Spam überflutet werden (Art. 6 Abs. 1 lit. f DSGVO).

Wir verwenden keine Werbe-Cookies, keine Analysewerkzeuge und kein seitenübergreifendes Tracking. Abgesehen von der oben genannten E-Mail-Adresse speichert die Website eine einzige Einstellung in Ihrem Browser: ob Sie die helle oder die dunkle Darstellung gewählt haben.

## Wer Ihre Daten Erhält

Unsere eigenen Mitarbeitenden, soweit ihre Arbeit es erfordert. Dienstleister, die die Website betreiben und unsere E-Mails verarbeiten, auf Grundlage von Verträgen, die sie an unsere Weisungen binden. Und wenn Sie uns mit dem Transport von Waren beauftragen, die Frachtführer, Zollbehörden, Hafenbetreiber und Agenten, die die Daten für den Transport benötigen, soweit die Sendung es erfordert. Behörden geben wir Daten nur weiter, wenn das Gesetz uns dazu verpflichtet.

## Übermittlungen Zwischen Europa und Zentralafrika

${inEu && outsideEu
    ? "Wir arbeiten an beiden Enden des Handels zwischen Europa und Zentralafrika. Wenn Sie uns mit einem Transport zwischen beiden beauftragen, reisen Ihre Daten mit der Sendung: Wir übermitteln sie nach Kamerun oder aus Kamerun in die Europäische Union, soweit dies zur Erfüllung des von Ihnen gewünschten Vertrags erforderlich ist (Art. 49 Abs. 1 lit. b und c DSGVO). Für Kamerun besteht kein Angemessenheitsbeschluss der Europäischen Kommission; dort gespeicherte Daten sind durch kamerunisches Recht und durch unsere eigenen Kontrollen geschützt."
    : "Wenn eine Sendung es erfordert, übermitteln wir Daten an die Frachtführer und Agenten am Bestimmungsort, soweit dies zur Erfüllung des von Ihnen gewünschten Vertrags erforderlich ist (Art. 49 Abs. 1 lit. b und c DSGVO)."}

## Wie Lange Wir Daten Speichern

So lange, wie wir sie für den Zweck benötigen, zu dem sie erhoben wurden, und nicht länger. Anfragen, aus denen kein Auftrag entsteht, löschen wir, sobald sie für die Beantwortung nicht mehr benötigt werden. Unterlagen zu Sendungen, Angeboten, Rechnungen und Korrespondenz bewahren wir so lange auf, wie Handels- und Steuerrecht es verlangen: in Deutschland bis zu zehn Jahre (§ 257 HGB, § 147 AO) und zehn Jahre nach dem in Kamerun geltenden einheitlichen OHADA-Rechnungslegungsakt. Bewerbungen löschen wir sechs Monate nach Besetzung der Stelle, sofern Sie einer längeren Aufbewahrung nicht zugestimmt haben.

## Ihre Rechte

Sie können jederzeit Auskunft darüber verlangen, welche Daten wir über Sie speichern, und eine Kopie erhalten; Sie können die Berichtigung, Löschung oder Einschränkung der Verarbeitung verlangen, Ihre Daten in einem maschinenlesbaren Format erhalten und der Verarbeitung widersprechen, soweit wir uns auf unser berechtigtes Interesse stützen. Eine erteilte Einwilligung können Sie jederzeit widerrufen, ohne dass die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung berührt wird. Schreiben Sie an ${contact}.

Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem Land, in dem Sie leben oder arbeiten${inEu ? ", oder in Deutschland bei der Aufsichtsbehörde des Bundeslandes, in dem unser deutsches Unternehmen seinen Sitz hat" : ""}${outsideEu ? ". In Kamerun können Sie sich an die für den Schutz personenbezogener Daten zuständige nationale Behörde wenden" : ""}.

## Änderungen Dieser Erklärung

Wir passen diese Erklärung an, wenn sich unser Umgang mit Daten ändert. Version und Datum oben zeigen Ihnen, welche Fassung Sie lesen.
`,
};

/**
 * @param {Array} legal  `site_brand.service.publicLegal()` output
 * @returns {{en: {title, summary, body}, de: {title, summary, body}}}
 */
function draft(legal) {
  const inEu = legal.some((e) => EU.has(String(e.country_code || "").toUpperCase()));
  const outsideEu = legal.some((e) => !EU.has(String(e.country_code || "").toUpperCase()));
  const email = legal.map((e) => e.email).find(has);
  const out = {};
  for (const [lang, L] of [["en", EN], ["de", DE]]) {
    const contact = email || (lang === "de" ? "die oben genannte Adresse" : "the address above");
    out[lang] = {
      title: L.title,
      summary: L.summary,
      body: L.body(legal.map((e) => controllerBlock(e, L)), inEu, outsideEu, contact),
    };
  }
  return out;
}

module.exports = { draft };

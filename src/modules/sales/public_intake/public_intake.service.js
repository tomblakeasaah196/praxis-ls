"use strict";

const lead = require("../lead/lead.service");
const quote = require("../quote_request/quote_request.service");
const enquiry = require("../inbound_intake/inbound_intake.service");
const partnership = require("../partnership_request/partnership_request.service");
const campaign = require("../marketing_campaign/marketing_campaign.service");
const geoPlace = require("../../operations/geo_place/geo_place.service");
const vault = require("../../vault/document_vault/document_vault.service");
const { quoteRequest } = require("@praxis/shared");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/**
 * The same ceilings the careers page applies to a CV, for the same reason.
 *
 * This is the second upload path an unauthenticated stranger can reach, so the
 * bytes are sniffed rather than believed: a .exe that declares itself a PDF is
 * refused on what it contains. PDF and images only — a quote attachment is a
 * packing list, a commercial invoice or a photograph of the cargo, and those
 * are the three formats `sniffContentType` can actually verify. Accepting a
 * .docx here would mean accepting it unsniffed.
 */
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];

const receipt = (row) => ({
  received: true,
  reference: row.public_ref || row.quote_request_id || row.contact_enquiry_id
    || row.partnership_request_id || row.email,
});

/**
 * Resolve one place the requester picked, or null.
 *
 * NEVER throws. A prospect who has typed a route and attached an invoice must
 * not lose the enquiry because Geoapify timed out — the text they typed is
 * already in `origin_location`, which is what the desk reads, and the pin is
 * enrichment. `confirmSuggestion` re-queries the provider and takes ITS
 * coordinate, so what is stored is provider-vouched however it was requested;
 * the only thing a failure costs is the pin.
 *
 * `confirmedBy: "the requester"` because that is the truth. The operator
 * picker's provenance string says "confirmed by an operator" and a row written
 * from an anonymous form must not claim that — somebody reading the catalogue
 * later has to be able to tell which places a colleague vouched for.
 */
async function resolvePlace(client, pick, label) {
  if (!pick || !pick.provider_place_id) return null;
  try {
    const row = await geoPlace.confirmSuggestion(client, {
      query: pick.query,
      providerPlaceId: pick.provider_place_id,
      country: pick.country || null,
      confirmedBy: "the requester",
      actor: {},
    });
    return row ? row.geo_place_id : null;
  } catch (err) {
    logger.warn(
      { err: { message: err && err.message, code: err && err.code }, label },
      "[public_intake] could not resolve the picked place — filing the request without a pin",
    );
    return null;
  }
}

/**
 * Store the one optional attachment, or explain why it was refused.
 *
 * The asymmetry is deliberate and is the lesson careers.service records in its
 * own comment: a REJECTED file is the requester's problem and they must be told
 * — silently dropping a 20 MB invoice and confirming the request leaves them
 * believing the desk has a file nobody received. A STORAGE failure is ours, and
 * the enquiry is worth more than the attachment, so it is logged and the quote
 * is filed without it.
 *
 * `status < 500` is the line between the two, and it is spelled that way rather
 * than `httpStatus` because AppError has never had the latter — reading the
 * wrong property made every rejection look like our outage.
 */
async function storeAttachment(client, data) {
  if (!data.attachment_data_url) return null;
  return storeOne(client, { data_url: data.attachment_data_url, filename: data.attachment_filename });
}

/**
 * One website document into the vault, or null when OUR storage failed — the
 * asymmetry above, per file. Filed under `quote_request:intake` until the
 * request exists; `quote.create` links it and re-files it under the request's
 * own reference in the same transaction (meeting 6, item 2.7: it used to stay
 * under `:intake` forever, in a column no staff screen read).
 */
async function storeOne(client, { data_url: dataUrl, filename = null }) {
  try {
    const doc = await vault.createDocument(client, {
      dataUrl,
      docType: "QUOTE_ATTACHMENT",
      entityRef: INTAKE_REF,
      originalName: filename || null,
      maxBytes: ATTACHMENT_MAX_BYTES,
      allowedTypes: ATTACHMENT_TYPES,
      sniff: true,
      actor: {},
    });
    return doc.doc_id;
  } catch (err) {
    if (err instanceof AppError && err.status < 500) throw err;
    logger.error({ err }, "[public_intake] attachment upload failed — filing the request without it");
    return null;
  }
}

/** Where a website document waits between its upload and its request's insert. */
const INTAKE_REF = "quote_request:intake";

/** Decoded bytes a base64 data URL carries, without decoding it. */
const decodedBytes = (dataUrl) => {
  const comma = String(dataUrl || "").indexOf(",");
  return comma < 0 ? 0 : Math.floor(((String(dataUrl).length - comma - 1) * 3) / 4);
};

/**
 * Every document the visitor attached — `documents[]` (meeting 6, PR 2: up to
 * three, each with what it is) and the single field the form sent before it —
 * stored one by one, refused as a whole when together they exceed what the
 * form promises. Encouraged, never required: a stranger may not have a
 * commercial invoice yet and must not be turned away (owner decision Q6).
 */
async function storeDocuments(client, data) {
  const offered = [
    ...(Array.isArray(data.documents) ? data.documents : []),
    ...(data.attachment_data_url ? [{ data_url: data.attachment_data_url, filename: data.attachment_filename }] : []),
  ].slice(0, quoteRequest.PUBLIC_DOCUMENTS_MAX + 1);
  if (offered.length > quoteRequest.PUBLIC_DOCUMENTS_MAX) {
    throw new AppError("TOO_MANY_FILES", `At most ${quoteRequest.PUBLIC_DOCUMENTS_MAX} documents`, 422, {
      documents: [`at most ${quoteRequest.PUBLIC_DOCUMENTS_MAX}`],
    });
  }
  const total = offered.reduce((n, d) => n + decodedBytes(d.data_url), 0);
  if (total > quoteRequest.PUBLIC_DOCUMENTS_TOTAL_BYTES) {
    throw new AppError("FILES_TOO_LARGE", "The documents together are too large", 413, {
      documents: [`${Math.round(quoteRequest.PUBLIC_DOCUMENTS_TOTAL_BYTES / (1024 * 1024))} MB in all`],
    });
  }
  const out = [];
  for (const d of offered) {
    const docId = await storeOne(client, d);
    if (docId) out.push({ doc_id: docId, document_kind: d.document_kind || null });
  }
  return out;
}

/** A website quote is one funnel intake: lead + linked quote or nothing. */
async function submitQuote(client, data) {
  const entityId = await quote.resolveEntityId(client, { data });

  // Both of these run BEFORE the transaction opens, and that ordering is load
  // bearing: each makes an HTTP call to Geoapify or writes an 8 MB object, and
  // holding a database connection open across either is how a slow provider
  // becomes a pool exhaustion. It is the same rule geoapify.service states for
  // its own callers.
  // The service first: a stale tab naming a service the tenant has since
  // unpublished is told so before any file is stored for it.
  const st = data.service_type_id
    ? await quote.resolveService(client, data.service_type_id, { publishedOnly: true })
    : null;
  if (st) quote.assertIncotermOffered(st, data.incoterm);
  // What the lead calls the service — the same display copy the request gets.
  const serviceInterest = st ? st.name_en || st.name_fr : data.service_category || null;
  const documents = await storeDocuments(client, data);
  const originPlaceId = await resolvePlace(client, data.origin_place, "origin");
  const destinationPlaceId = await resolvePlace(client, data.destination_place, "destination");

  return atomically(client, async () => {
    const createdLead = await lead.create(client, {
      data: {
        entity_id: entityId,
        company_name: data.requester_company || data.requester_name
          || data.requester_email || "Website quote request",
        contact_name: data.requester_name || null,
        email: data.requester_email || null,
        phone: data.requester_phone || null,
        source: "WEBSITE",
        intake_channel: "WEBSITE",
        service_interest: serviceInterest,
        details: {
          origin_location: data.origin_location || null,
          destination_location: data.destination_location || null,
          cargo_description: data.cargo_description || null,
          incoterm: data.incoterm,
        },
      },
      actor: {},
    });
    const request = await quote.create(client, {
      data: {
        ...data,
        entity_id: entityId,
        lead_id: createdLead.lead_id,
        intake_channel: "WEBSITE",
        origin_place_id: originPlaceId,
        destination_place_id: destinationPlaceId,
        // The first document stays in the column 12756 gave it, so the record
        // of what the form sent reads the same as before; every document is a
        // quote_request_attachment row as well (below), which is what staff see.
        attachment_doc_id: documents.length ? documents[0].doc_id : null,
        // The picks themselves are not columns; dropping them keeps the
        // spread above from carrying two objects into a row builder that would
        // ignore them silently.
        origin_place: undefined,
        destination_place: undefined,
        attachment_data_url: undefined,
        attachment_filename: undefined,
        documents: undefined,
      },
      actor: {},
      options: {
        publishedOnly: true,
        requireDirection: true,
        documents: { docs: documents, fromRef: INTAKE_REF },
      },
    });
    return receipt(request);
  });
}

async function submitContact(client, data) {
  const row = await enquiry.submitEnquiry(client, {
    data: { ...data, source: "WEBSITE" },
    actor: {},
  });
  return receipt(row);
}

async function submitPartnership(client, data) {
  const row = await partnership.create(client, {
    data: { ...data, intake_channel: "WEBSITE" },
    actor: {},
  });
  return receipt(row);
}

async function subscribe(client, data) {
  const row = await campaign.subscribe(client, {
    email: data.email,
    name: data.name,
    source: "website",
    actor: {},
  });
  return receipt(row);
}

module.exports = {
  submitQuote, submitContact, submitPartnership, subscribe, receipt,
  // Exported for the tests, which assert the two failure asymmetries directly:
  // a place that cannot be resolved must not cost the enquiry, and a file the
  // requester can fix must reach them rather than being swallowed.
  resolvePlace, storeAttachment, storeDocuments,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, INTAKE_REF,
};

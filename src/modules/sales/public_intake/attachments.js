"use strict";

/**
 * A website visitor's attachments: checked, typed from their bytes, and stored.
 *
 * ── WHAT A VISITOR MAY SEND ──────────────────────────────────────────────
 *
 * PDF, JPEG, PNG, WEBP, HEIC (what an iPhone photographs), DOCX and XLSX, up to
 * 20 MB together and ten files (`@praxis/shared` websiteMessages, the owner's
 * numbers). The browser's declared type and the file's name are NOT believed:
 * the type is read from the first bytes, so `invoice.pdf` that is really an
 * executable is refused on what it contains.
 *
 * DOCX and XLSX are ZIP archives, and "it is a ZIP" is not proof of anything:
 * the vault's own sniff accepts any archive that DECLARES an Office type. Here
 * the archive must also carry the part an Office file cannot exist without
 * (`word/document.xml`, `xl/workbook.xml`) and the `[Content_Types].xml` every
 * OOXML package has. A zip of anything else, renamed .docx, is refused.
 *
 * ── STORAGE FAILURES ─────────────────────────────────────────────────────
 *
 * Same asymmetry as the quote form (`public_intake.service`): a file the visitor
 * can fix (wrong type, too big) is THEIR error and is reported back; a failure
 * of OUR storage is logged and the message is filed without that file, because
 * the message is worth more than the attachment and the desk can ask for it.
 */

const path = require("path");
const { websiteMessages } = require("@praxis/shared");
const vault = require("../../vault/document_vault/document_vault.service");
const { parseDataUrl } = require("../../../utils/data-url");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const { ATTACHMENTS_TOTAL_BYTES, ATTACHMENTS_MAX_FILES, ATTACHMENT_TYPES, DOCX, XLSX } = websiteMessages;

/** Where a visitor's files wait between upload and their message's insert. */
const STAGING_REF = "contact_enquiry:intake";
const DOC_TYPE = "ENQUIRY_ATTACHMENT";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** The type these bytes are, from the bytes alone, or null. */
function sniffAttachment(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const head4 = buffer.toString("latin1", 0, 4);
  if (head4 === "%PDF") return "application/pdf";
  if (buffer[0] === 0x89 && head4.slice(1) === "PNG") return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (head4 === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buffer.toString("latin1", 4, 8) === "ftyp") {
    const brand = buffer.toString("latin1", 8, 12).replace(/\0/g, " ").trim().toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    return null;
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    // Member names are stored as plain text in each local header and again in
    // the central directory, so a search over the bytes finds them without
    // unpacking anything.
    if (buffer.indexOf("[Content_Types].xml", 0, "latin1") < 0) return null;
    if (buffer.indexOf("word/document.xml", 0, "latin1") >= 0) return DOCX;
    if (buffer.indexOf("xl/workbook.xml", 0, "latin1") >= 0) return XLSX;
    return null;
  }
  return null;
}

/** A name safe to store and to put in an email: no path, no control bytes. */
function cleanName(name, type) {
  const base = path.basename(String(name || "").replace(/\\/g, "/")).replace(/[\p{Cc}"<>]/gu, "").trim();
  const ext = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", [DOCX]: "docx", [XLSX]: "xlsx" }[type];
  const fallback = `attachment.${ext || "bin"}`;
  return (base || fallback).slice(0, 200);
}

/**
 * Decode, count and type every file. Pure and synchronous: runs before any
 * storage or transaction, so a refusal costs nothing.
 *
 * @param {{data_url: string, filename?: string}[]} documents
 * @returns {{buffer: Buffer, type: string, name: string, bytes: number}[]}
 */
function prepare(documents) {
  const list = Array.isArray(documents) ? documents : [];
  if (list.length > ATTACHMENTS_MAX_FILES) {
    throw new AppError("TOO_MANY_FILES", `At most ${ATTACHMENTS_MAX_FILES} files`, 422, {
      documents: [`at most ${ATTACHMENTS_MAX_FILES} files`],
    });
  }
  const out = [];
  let total = 0;
  for (const d of list) {
    const parsed = parseDataUrl(d && d.data_url);
    if (!parsed || !parsed.buffer || !parsed.buffer.length) {
      throw new AppError("BAD_FILE", "A file could not be read", 422, { documents: ["a file could not be read"] });
    }
    total += parsed.buffer.length;
    if (total > ATTACHMENTS_TOTAL_BYTES) {
      throw new AppError("FILES_TOO_LARGE", "The files together are too large", 413, {
        documents: [`${Math.round(ATTACHMENTS_TOTAL_BYTES / (1024 * 1024))} MB in all`],
      });
    }
    const type = sniffAttachment(parsed.buffer);
    if (!type || !ATTACHMENT_TYPES.includes(type)) {
      throw new AppError("BAD_FILE_TYPE", "Only PDF, images, Word and Excel files can be attached", 422, {
        documents: ["PDF, JPG, PNG, WEBP, HEIC, DOCX or XLSX only"],
      });
    }
    out.push({ buffer: parsed.buffer, type, name: cleanName(d.filename, type), bytes: parsed.buffer.length });
  }
  return out;
}

const EXT_TYPE = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", docx: DOCX, xlsx: XLSX,
};

/**
 * Store prepared files in the vault under the staging reference. Returns the
 * stored ones; a storage failure drops that file and is logged (see above).
 * Runs OUTSIDE the message's transaction: writing 20 MB while holding a
 * connection is how a slow disk becomes an exhausted pool.
 */
async function store(client, prepared) {
  const stored = [];
  for (const [i, f] of prepared.entries()) {
    try {
      const doc = await vault.createDocument(client, {
        file: { buffer: f.buffer, mimetype: f.type, originalname: f.name },
        docType: DOC_TYPE,
        entityRef: STAGING_REF,
        originalName: f.name,
        maxBytes: ATTACHMENTS_TOTAL_BYTES,
        allowedTypes: ATTACHMENT_TYPES,
        sniff: f.type !== "image/heic",
        actor: {},
      });
      // A HEIC is converted to JPEG on the way in; what is stored is what the
      // desk and the inbox receive, so the type follows the stored file.
      const ext = String(doc.storage_path || "").split(".").pop().toLowerCase();
      const storedType = EXT_TYPE[ext] || f.type;
      const name = storedType !== f.type && storedType === "image/jpeg"
        ? f.name.replace(/\.(heic|heif)$/i, "") + ".jpg"
        : f.name;
      stored.push({ doc_id: doc.doc_id, original_name: name, content_type: storedType, byte_size: f.bytes, sort_order: i });
    } catch (err) {
      if (err instanceof AppError && err.status < 500) throw err;
      logger.error({ err }, "[public_intake] a website attachment could not be stored; filing the message without it");
    }
  }
  return stored;
}

module.exports = { prepare, store, sniffAttachment, cleanName, STAGING_REF, DOC_TYPE };

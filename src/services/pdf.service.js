/**
 * PDF service (KB §8.4). Renders HTML → PDF (Puppeteer/Chromium, lazily required
 * so importing this module never launches a browser), stores it via the storage
 * driver, computes the SHA-256 content DNA, and captures it in document_vault
 * with a QR-verifiable token. Runs from the `pdf` worker job.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../config/env");
const storage = require("./storage.service");
const documents = require("./documents/document.service");

/** SHA-256 hex of the rendered bytes — the doc DNA a QR resolves and re-checks. */
function contentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** QR-encodable verification token. */
function verifyToken(entityRef, hash) {
  return "praxis://verify/" + entityRef + "?h=" + String(hash).slice(0, 16);
}

/** Render HTML to a PDF Buffer. Chromium comes from PUPPETEER_EXECUTABLE_PATH. */
async function renderHtml(html) {
  /// eslint-disable-next-line global-require
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    executablePath: config.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}

/**
 * Render → store → capture. `key` is the storage key (tenant-namespaced by the
 * caller). Returns { key, public_url, content_hash, verify }. `render` is
 * injectable for tests.
 */
async function renderAndStore(client, { html, key, entityRef, docType, render = renderHtml }) {
  const buffer = await render(html);
  const hash = contentHash(buffer);
  const stored = await storage.put(buffer, { key, contentType: "application/pdf" });
  await documents.capture(client, { entityRef, docType, storagePath: stored.key, contentHash: hash, status: "VERIFIED" });
  return { key: stored.key, public_url: stored.public_url, content_hash: hash, verify: verifyToken(entityRef, hash) };
}

module.exports = { contentHash, verifyToken, renderHtml, renderAndStore };

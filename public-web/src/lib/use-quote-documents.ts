import * as React from "react";
import type { DocumentKind } from "@/lib/quote-scope";

/**
 * The documents a quote request is sent with — the state both quote wizards
 * share (meeting 6, PR 2, owner decisions Q4 and Q6).
 *
 * Every file gets the three things CLAUDE.md requires of an upload:
 *
 *   · a PREVIEW the moment the picker closes (an object URL for an image,
 *     revoked when the file is removed or the wizard closes);
 *   · COMPRESSION before the bytes leave the device, with the `document`
 *     profile — downsized, never tonally corrected, so a scanned invoice still
 *     matches the paper;
 *   · a 0→100 % PERCENTAGE ending in "Upload complete" only once the server
 *     has answered.
 *
 * WHEN the bytes go up is the caller's: the portal passes `upload`, and each
 * file goes up the moment it is picked (staged against the client, linked when
 * the request is sent — so a request can never exist without its document);
 * the website passes none, and the prepared files travel inside the request
 * itself, with the request's own progress (`setAllProgress`).
 */

export type QuoteDocState = "preparing" | "ready" | "uploading" | "done" | "error";

export type QuoteDoc = {
  id: string;
  name: string;
  bytes: number;
  originalBytes: number | null;
  kind: DocumentKind;
  previewUrl: string | null;
  state: QuoteDocState;
  pct: number;
  error: string | null;
  /** The prepared (compressed) file. */
  file: File | null;
  /** What the server called it once staged (portal). */
  docId: string | null;
};

export const QUOTE_DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
const TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

let seq = 0;
const nextId = () => `doc-${Date.now().toString(36)}-${(seq += 1)}`;

export function useQuoteDocuments(opts: {
  /** Per file, after compression. */
  maxBytes: number;
  /** All files together (the website's body limit). */
  maxTotalBytes?: number;
  maxFiles: number;
  /** The types a server accepts; PDF and images by default. */
  types?: string[];
  /** Upload one prepared file now (portal); resolves to the staged id. */
  upload?: (file: File, onProgress: (pct: number) => void, kind: DocumentKind) => Promise<{ doc_id: string }>;
  /** Error sentences, already translated: the caller owns its dictionary. */
  messages: { badType: string; tooBig: string; tooMany: string; totalTooBig: string; unreadable: string };
}) {
  const [items, setItems] = React.useState<QuoteDoc[]>([]);
  const [note, setNote] = React.useState<string | null>(null);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  // Every preview URL pins its file in memory until it is revoked.
  React.useEffect(
    () => () => {
      for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    },
    [],
  );

  const patch = React.useCallback((id: string, p: Partial<QuoteDoc>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const send = React.useCallback(
    async (id: string, file: File, kind: DocumentKind) => {
      const up = optsRef.current.upload;
      if (!up) return;
      patch(id, { state: "uploading", pct: 0, error: null });
      try {
        const out = await up(file, (pct) => patch(id, { pct }), kind);
        patch(id, { state: "done", pct: 100, docId: out.doc_id });
      } catch (e) {
        patch(id, { state: "error", error: e instanceof Error ? e.message : optsRef.current.messages.unreadable });
      }
    },
    [patch],
  );

  const add = React.useCallback(
    async (files: FileList | File[] | null, kind: DocumentKind) => {
      const list = files ? Array.from(files) : [];
      if (!list.length) return;
      setNote(null);
      const o = optsRef.current;
      const room = o.maxFiles - itemsRef.current.length;
      if (room <= 0) {
        setNote(o.messages.tooMany);
        return;
      }
      if (list.length > room) setNote(o.messages.tooMany);
      for (const raw of list.slice(0, room)) {
        const id = nextId();
        setItems((cur) => [
          ...cur,
          { id, name: raw.name, bytes: raw.size, originalBytes: null, kind, previewUrl: null, state: "preparing", pct: 0, error: null, file: null, docId: null },
        ]);
        // Phones label a HEIC photo image/heic and some browsers leave `type`
        // empty; both are refused by the server's sniff, so say so now.
        if (!(o.types || TYPES).includes(raw.type)) {
          patch(id, { state: "error", error: o.messages.badType });
          continue;
        }
        try {
          // Loaded on first use, not with the hook: the website's wizard holds
          // this hook from its first step, and the compressor is only needed
          // once a file is picked (see quote-wizard.tsx, `loadDocumentsStep`).
          const { compressImage, isPreviewableImage, previewUrlFor } = await import("@/lib/image-compress");
          const { file, originalBytes } = await compressImage(raw, "document");
          if (file.size > o.maxBytes) {
            patch(id, { state: "error", error: o.messages.tooBig, bytes: file.size });
            continue;
          }
          const used = itemsRef.current.filter((it) => it.id !== id && it.state !== "error").reduce((n, it) => n + it.bytes, 0);
          if (o.maxTotalBytes && used + file.size > o.maxTotalBytes) {
            patch(id, { state: "error", error: o.messages.totalTooBig, bytes: file.size });
            continue;
          }
          patch(id, {
            name: file.name,
            bytes: file.size,
            originalBytes: originalBytes && originalBytes > file.size ? originalBytes : null,
            previewUrl: isPreviewableImage(file) ? previewUrlFor(file) : null,
            file,
            state: "ready",
          });
          if (o.upload) void send(id, file, kind);
        } catch {
          patch(id, { state: "error", error: o.messages.unreadable });
        }
      }
    },
    [patch, send],
  );

  const remove = React.useCallback((id: string) => {
    setItems((cur) => {
      const it = cur.find((x) => x.id === id);
      if (it && it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return cur.filter((x) => x.id !== id);
    });
    setNote(null);
  }, []);

  const setKind = React.useCallback((id: string, kind: DocumentKind) => patch(id, { kind }), [patch]);

  /** Try a failed portal upload again. */
  const retry = React.useCallback(
    (id: string) => {
      const it = itemsRef.current.find((x) => x.id === id);
      if (it && it.file) void send(id, it.file, it.kind);
    },
    [send],
  );

  /** The website's request carries its files: one bar for the lot. */
  const setAllProgress = React.useCallback((pct: number, done = false) => {
    setItems((cur) =>
      cur.map((it) => (it.state === "error" ? it : { ...it, pct, state: done ? "done" : "uploading" })),
    );
  }, []);

  const reset = React.useCallback(() => {
    for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    setItems([]);
    setNote(null);
  }, []);

  const usable = items.filter((it) => it.state !== "error");
  return {
    items,
    note,
    add,
    remove,
    setKind,
    retry,
    reset,
    setAllProgress,
    /** Every kept file is ready to send: picked, compressed — and, on the portal, staged. */
    settled: usable.every((it) => (opts.upload ? it.state === "done" : it.state === "ready" || it.state === "done")),
    busy: items.some((it) => it.state === "preparing" || it.state === "uploading"),
    count: usable.length,
  };
}

export type QuoteDocuments = ReturnType<typeof useQuoteDocuments>;

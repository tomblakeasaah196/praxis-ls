import * as React from "react";
import type { UploadProfile } from "@/lib/image-compress";

/**
 * useUpload, public-web's copy of the upload engine's state machine
 * (`client/src/lib/use-upload.ts`), for files that go up WITH the form on
 * Send: the message button and the contact form (SmartLS website v2, PR 2).
 *
 * CLAUDE.md rule three, in this app: `FilePicker` + `UploadList` +
 * `useUpload({ autoStart: false })`. Every file gets
 *
 *   · a PREVIEW the moment the picker closes (an object URL for an image,
 *     revoked on removal and on unmount);
 *   · COMPRESSION before the bytes leave the device, profile `document`: an
 *     oversized photo is downsized, a scan is never tonally corrected, and a
 *     PDF, Word or Excel file passes through untouched;
 *   · a 0 to 100 % PERCENTAGE while the form sends, ending in "Upload
 *     complete" only once the SERVER has answered (`setProgress(100, true)`).
 *
 * Only `autoStart: false` exists here. An anonymous visitor has nowhere to
 * stage a file before the message exists, so the files travel inside the one
 * request that creates it and share its progress.
 */

export type UploadState = "preparing" | "ready" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  name: string;
  bytes: number;
  /** Before compression, when compression made it smaller. */
  originalBytes: number | null;
  previewUrl: string | null;
  state: UploadState;
  percent: number;
  error: string | null;
  /** What will be sent: the compressed file. */
  file: File | null;
};

export type UseUploadOptions = {
  profile?: UploadProfile;
  /** Deferred upload: the files go with the form. The only mode in this app. */
  autoStart: false;
  /** Accepted MIME types; a file with an empty or generic type is matched by extension. */
  types: readonly string[];
  /** Extension fallbacks for the types above (".heic" on a browser that labels it ""). */
  extensions: readonly string[];
  maxFiles: number;
  /** All files together, after compression. */
  maxTotalBytes: number;
  /** Sentences, already translated: the caller owns its dictionary. */
  messages: { badType: string; tooMany: string; totalTooBig: string; unreadable: string };
};

let seq = 0;
const nextId = () => `up-${Date.now().toString(36)}-${(seq += 1)}`;

const accepted = (file: File, o: UseUploadOptions) => {
  const type = (file.type || "").toLowerCase();
  if (type && o.types.includes(type)) return true;
  const name = file.name.toLowerCase();
  return o.extensions.some((ext) => name.endsWith(ext));
};

export function useUpload(opts: UseUploadOptions) {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [note, setNote] = React.useState<string | null>(null);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  React.useEffect(
    () => () => {
      for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    },
    [],
  );

  const patch = React.useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const pick = React.useCallback(
    async (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (!list.length) return;
      setNote(null);
      const o = optsRef.current;
      const room = o.maxFiles - itemsRef.current.filter((it) => it.state !== "error").length;
      if (room <= 0) {
        setNote(o.messages.tooMany);
        return;
      }
      if (list.length > room) setNote(o.messages.tooMany);
      // Loaded on first pick, not with the form: most messages carry no file.
      const { compressImage, isPreviewableImage, previewUrlFor } = await import("@/lib/image-compress");
      for (const raw of list.slice(0, room)) {
        const id = nextId();
        const previewUrl = isPreviewableImage(raw) ? previewUrlFor(raw) : null;
        setItems((cur) => [
          ...cur,
          { id, name: raw.name, bytes: raw.size, originalBytes: null, previewUrl, state: "preparing", percent: 0, error: null, file: null },
        ]);
        if (!accepted(raw, o)) {
          patch(id, { state: "error", error: o.messages.badType });
          continue;
        }
        try {
          const { file, originalBytes } = await compressImage(raw, o.profile || "document");
          const used = itemsRef.current
            .filter((it) => it.id !== id && it.state !== "error")
            .reduce((n, it) => n + it.bytes, 0);
          if (used + file.size > o.maxTotalBytes) {
            patch(id, { state: "error", error: o.messages.totalTooBig, bytes: file.size });
            continue;
          }
          patch(id, {
            name: file.name,
            bytes: file.size,
            originalBytes: originalBytes && originalBytes > file.size ? originalBytes : null,
            file,
            state: "ready",
          });
        } catch {
          patch(id, { state: "error", error: o.messages.unreadable });
        }
      }
    },
    [patch],
  );

  const remove = React.useCallback((id: string) => {
    setItems((cur) => {
      const it = cur.find((x) => x.id === id);
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return cur.filter((x) => x.id !== id);
    });
    setNote(null);
  }, []);

  const reset = React.useCallback(() => {
    for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    setItems([]);
    setNote(null);
  }, []);

  /** The form's request reports here: one bar for every file it carries. */
  const setProgress = React.useCallback((percent: number, done = false) => {
    setItems((cur) =>
      cur.map((it) =>
        it.state === "error" ? it : { ...it, percent: done ? 100 : Math.min(99, percent), state: done ? "done" : "uploading" },
      ),
    );
  }, []);

  /** Back to ready after a failed send, so the visitor can try again. */
  const rewind = React.useCallback(() => {
    setItems((cur) => cur.map((it) => (it.state === "uploading" ? { ...it, state: "ready", percent: 0 } : it)));
  }, []);

  /** The kept files as `{ data_url, filename }`, for the request body. */
  const payload = React.useCallback(async () => {
    const { fileToDataUrl } = await import("@/lib/image-compress");
    const kept = itemsRef.current.filter((it) => it.file && it.state !== "error");
    return Promise.all(kept.map(async (it) => ({ data_url: await fileToDataUrl(it.file as File), filename: it.name })));
  }, []);

  const usable = items.filter((it) => it.state !== "error");
  return {
    items,
    note,
    pick,
    remove,
    reset,
    setProgress,
    rewind,
    payload,
    count: usable.length,
    totalBytes: usable.reduce((n, it) => n + it.bytes, 0),
    busy: items.some((it) => it.state === "preparing" || it.state === "uploading"),
  };
}

export type Upload = ReturnType<typeof useUpload>;

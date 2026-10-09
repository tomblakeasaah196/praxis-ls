/**
 * Shared building blocks for the Settings editors (Appearance, Login screen).
 * ImageField reuses the existing branding upload (uploadImage → POST
 * /branding/logo), so there's one upload path for logos, favicon, backgrounds
 * and per-business logos. `Soon` marks controls whose value is edited/sent but
 * not yet persisted by the backend (branding schema is being extended — see
 * doc/FE_IA_HANDOFF.md).
 */
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { uploadImage } from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { InfoHint } from "@/components/ui/info-hint";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl, type UploadProfile } from "@/lib/image-compress";

/** "pending backend" badge. */
export function Soon({ className }: { className?: string }) {
  return (
    <span
      className={cn("status st-warn !px-2 !py-0.5 !text-[9px]", className)}
      title="Editable now; persistence pending a backend field."
    >
      pending backend
    </span>
  );
}

/**
 * A Settings card: a heading, its explanation behind an ⓘ, and its controls.
 *
 * `desc` IS NO LONGER PRINTED. It renders behind the ⓘ on the card, the way
 * `Dialog`, `PageHeader`, entity 360's `Section` and `Chart` already render
 * theirs, and this docblock used to ask call sites to do that by hand: "a card
 * whose explanation runs past a few words puts it behind an ⓘ here instead and
 * drops `desc`".
 *
 * 30 OF THE 50 DID NOT. They printed 80 to 229 characters under the heading,
 * on every visit, and the prose gate could not see any of it: it reads `hint=`
 * and deliberately skips `description=`, on the stated grounds that "every
 * component that takes one now renders it behind an ⓘ". That was true of every
 * component except this one, and this one is the card the entire Settings
 * family is built from. It is the single largest block of printed supporting
 * text in the product, which is the tenant's complaint almost exactly.
 *
 * So the CONTAINER changed rather than the call sites, which is what
 * doc/UI_SIMPLIFICATION.md records as the highest-leverage edit available: one
 * component, 50 sites, no call-site churn. A short `desc` that merely restated
 * its heading was deleted in the same sweep rather than hidden, because §3.17's
 * ladder deletes before it hides.
 *
 * HIDDEN IS NOT DELETED. `InfoHint` keeps the text in a visually hidden node
 * and points the trigger at it with `aria-describedby`, so a screen reader
 * still reaches it.
 *
 * WHAT MUST NOT GO IN `desc`. A consequence — what a switch will destroy, that
 * a choice cannot be undone, that five wrong tries lock an account. Nobody
 * hovers before they act. Those go in `notice`, which is printed in the card
 * body above the controls, or in the `useConfirm()` at the point of commit.
 * §3.17 calls this point-of-action disclosure.
 *
 * `action` remains the card's top-right slot for a control that belongs to the
 * whole card. A call site that already passes its own `<InfoHint>` there keeps
 * working: none of the 55 call sites passes both.
 */
export function SettingsCard({
  title,
  desc,
  notice,
  soon,
  action,
  children,
  className,
}: {
  title: string;
  /** The explanation, behind the ⓘ. Never a consequence — see `notice`. */
  desc?: string;
  /** A consequence the reader must see BEFORE they touch the controls. */
  notice?: React.ReactNode;
  soon?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("lux-card p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {/* The ⓘ is a SIBLING of the heading, never a child of it: inside the
              <h2> its aria-label joins the accessible name and the card starts
              announcing as "Authenticator App About Authenticator App". */}
          <h2 className="font-display text-lg tracking-tight">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {desc && <InfoHint label={`About ${title}`}>{desc}</InfoHint>}
          {action}
          {soon && <Soon />}
        </div>
      </div>
      {notice && <div className="mb-4">{notice}</div>}
      {children}
    </div>
  );
}

export function Field({
  label,
  about,
  soon,
  children,
}: {
  label: string;
  /** The field's explanation, behind an ⓘ beside the label. The modal `Field`
   *  (ui/modal.tsx) has had this since §3.17 was written; this one did not, so
   *  a settings screen with something to say about one control had nowhere to
   *  put it but a printed paragraph. */
  about?: string;
  soon?: boolean;
  children: React.ReactNode;
}) {
  /*
   * Audit F4, again, for the settings family: this Field rendered its Label
   * as a sibling with no association, so every control under it — partner
   * names, credential references, theme values — was unlabelled to a screen
   * reader even though it looked labelled on screen. The modal `Field`
   * (ui/modal.tsx) fixed the same defect for the form fields there; this one
   * now wires the same association: a `useId`-minted id on the single control
   * child, and the Label pointing at it. A child that brings its own id
   * keeps it, and children that are not a single element are rendered as
   * they were rather than guessed at.
   */
  const uid = React.useId();
  const only =
    React.Children.count(children) === 1
      ? React.Children.toArray(children)[0]
      : null;
  const single = React.isValidElement(only)
    ? (only as React.ReactElement<Record<string, unknown>>)
    : null;
  const controlId =
    single && typeof single.props.id === "string"
      ? single.props.id
      : `${uid}-control`;
  const aboutId = `${uid}-about`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        {/* The ⓘ is a SIBLING of the <Label>, never inside it: inside, its
            aria-label joins the label's accessible name and the field starts
            announcing as "Current Password About Current Password". §3.17. */}
        <Label htmlFor={single ? controlId : undefined}>{label}</Label>
        {about && (
          <InfoHint label={`About ${label}`} textId={aboutId}>
            {about}
          </InfoHint>
        )}
        {soon && <Soon />}
      </span>
      {/* HIDDEN IS NOT DELETED: the control points at the hidden copy of the
          text, so a screen reader reaching the input announces it. */}
      {single
        ? React.cloneElement(single, {
            id: controlId,
            ...(about ? { "aria-describedby": aboutId } : {}),
          })
        : children}
    </div>
  );
}

/** @deprecated Import `Textarea` from `@/components/ui/textarea` instead. This
 *  was one of the three local class constants F6 counted; it now just forwards,
 *  so existing settings screens keep working while they migrate. */
export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <Textarea {...props} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        {hint && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 flex-none rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-accent/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A labelled range input with its live value. Used by the App & PWA editor for
 * the icon transform, where the control has to be continuous — the whole point
 * is nudging a mark until it sits right inside a circular crop, which is not a
 * thing anyone can type.
 *
 * Native `<input type="range">` rather than a custom widget: it is already
 * keyboard-operable, already announces its value, and already respects the
 * platform's pointer conventions.
 */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "",
  hint,
  about,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Printed under the track. A bound is already min/max and a unit is already
   *  `unit`, so what belongs here is narrow. */
  hint?: string;
  /** Behind the ⓘ beside the label, for the explanation that used to be a
   *  printed `hint` on every slider on the PWA screen. */
  about?: string;
}) {
  const id = React.useId();
  const aboutId = `${id}-about`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          {/* SIBLING of the <Label>, never inside it. §3.17. */}
          <Label htmlFor={id}>{label}</Label>
          {about && (
            <InfoHint label={`About ${label}`} textId={aboutId}>
              {about}
            </InfoHint>
          )}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-5 w-full cursor-pointer accent-primary"
        aria-describedby={about ? aboutId : undefined}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ColorRow({
  token,
  value,
  onChange,
}: {
  token: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const safe = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 flex-none cursor-pointer rounded border bg-transparent p-0.5"
        aria-label={token}
      />
      <code className="w-24 flex-none text-[11px] text-muted-foreground">
        {token}
      </code>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}

/**
 * Image upload/preview/clear, reusing the branding upload endpoint. Returns the
 * stored /media URL via onChange. `shape` controls the thumbnail box.
 */
export function ImageField({
  label,
  value,
  onChange,
  soon,
  maxBytes = 512_000,
  minimumWidth,
  minimumHeight,
  hint,
  shape = "logo",
  upload,
  profile = "brand",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  soon?: boolean;
  maxBytes?: number;
  /** Minimum source dimensions required by the receiving endpoint. */
  minimumWidth?: number;
  minimumHeight?: number;
  hint?: string;
  shape?: "logo" | "square" | "wide";
  /**
   * Custom uploader returning the stored URL; defaults to the branding logo
   * upload. The second argument reports real upload progress — XHR gives it for
   * a JSON body too, so an uploader that ignores it still works but drives a
   * bar that only jumps.
   */
  upload?: (
    dataUrl: string,
    onProgress: (percent: number) => void,
  ) => Promise<string>;
  /**
   * What this picture IS, which decides whether it is tonally corrected.
   * Defaults to "brand" — the conservative choice for this control, because
   * most of its call sites are a tenant's logo or app icon and auto-levelling
   * one hands them back a slightly different colour on every screen. Pass
   * "photo" for an actual photograph, like the site hero.
   */
  profile?: UploadProfile;
}) {
  const [err, setErr] = React.useState<string | null>(null);

  const box =
    shape === "square"
      ? "h-12 w-12"
      : shape === "wide"
        ? "h-12 w-20 object-cover"
        : "h-8 w-auto max-w-[80px]";

  /**
   * Through the upload engine: compression before the bytes leave the device,
   * a preview of the NEW file (not just the already-saved `value`), and a real
   * percentage. Uploads on pick — there is no Save button on this control, the
   * stored URL is the state.
   */
  const uploader = useUpload<string>({
    profile,
    maxBytes,
    minimumWidth,
    minimumHeight,
    send: async (file, ctx) => {
      const dataUrl = await fileToDataUrl(file);
      return upload
        ? await upload(dataUrl, ctx.onProgress)
        : (await uploadImage(dataUrl, ctx.onProgress)).logoUrl;
    },
    onAllComplete: ([url]) => {
      if (url) onChange(url);
    },
  });

  const item = uploader.items[0] ?? null;
  const uploading =
    item?.state === "uploading" || item?.state === "compressing";

  React.useEffect(() => {
    if (item?.state !== "error") return;
    const cause = item.errorCause;
    setErr(
      cause instanceof ApiError && cause.status === 403
        ? "You need Settings edit permission to upload."
        : cause instanceof ApiError
          ? cause.message
          : item.error || "Upload failed. Try a smaller image, or paste a URL.",
    );
  }, [item?.state, item?.error, item?.errorCause]);

  function onFile(file?: File | null) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) {
      return setErr("That's not an image file.");
    }
    void uploader.pick([file]);
  }

  return (
    <Field label={label} soon={soon}>
      {/* The drop target adds a POINTER-ONLY shortcut on top of FilePicker's
          own control, which is what keyboard and AT users activate — so the
          drag handlers below are an enhancement, not the control. That is the
          same justification the <label> here carried before; only the rule name
          changes, because this is a <div> now. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}
        className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
      >
        {/* The preview shows the file being uploaded the moment it is picked,
            and falls back to the already-stored image. Before this, a failed or
            slow upload left the OLD logo on screen with no sign anything had
            happened. */}
        {item?.previewUrl || value ? (
          <img
            src={item?.previewUrl || value}
            alt=""
            className={cn("rounded", box)}
          />
        ) : (
          <span
            className={cn(
              "flex items-center justify-center rounded bg-muted",
              shape === "logo" ? "h-8 w-8" : box,
            )}
          >
            <span className="text-xs">IMG</span>
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <FilePicker
            variant="inline"
            accept="image/*"
            disabled={uploading}
            trigger={
              uploading
                ? "Uploading…"
                : value
                  ? "Replace"
                  : "Drop an image or click to upload"
            }
            onPick={(files) => onFile(files?.[0])}
          />
          {item && item.state !== "idle" && (
            <UploadProgress
              state={item.state}
              percent={item.percent}
              error={item.error}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value.startsWith("data:") ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste a hosted URL"
          className="h-8 text-xs"
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
          >
            Clear
          </Button>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </Field>
  );
}

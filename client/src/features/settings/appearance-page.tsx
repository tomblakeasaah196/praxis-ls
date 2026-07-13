/**
 * Appearance (white-label) settings. Set the tenant's brand colour, logo,
 * display name, and the pre-auth landing hero (eyebrow, headline, subheadline,
 * body, background image, and brand chips). Save writes to the `setting` table
 * (MOD-70) via PUT /branding and applies live through the branding context — so
 * every tenant screen (and the landing page) re-tints/re-copies the instant you
 * save.
 */
import * as React from "react";
import { useBranding } from "@/app/branding/branding-context";
import { saveBranding, uploadImage, type Branding, type BrandPill } from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const PRESETS = ["#0f766e", "#1d4ed8", "#b91c1c", "#7c3aed", "#c2410c", "#0891b2"];

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export function AppearancePage() {
  const { branding, setBranding } = useBranding();
  const [primary, setPrimary] = React.useState(branding.primary || "#0f766e");
  const [logoUrl, setLogoUrl] = React.useState(branding.logoUrl || "");
  const [name, setName] = React.useState(branding.name || "");
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Landing/hero content.
  const [eyebrow, setEyebrow] = React.useState(branding.hero?.eyebrow || "");
  const [headline, setHeadline] = React.useState(branding.hero?.headline || "");
  const [subheadline, setSubheadline] = React.useState(branding.hero?.subheadline || "");
  const [heroBody, setHeroBody] = React.useState(branding.hero?.body || "");
  const [heroImageUrl, setHeroImageUrl] = React.useState(branding.hero?.imageUrl || "");
  const [pills, setPills] = React.useState<BrandPill[]>(branding.hero?.pills || []);
  const [heroUploading, setHeroUploading] = React.useState(false);

  async function onSave(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    const patch: Partial<Branding> = {
      primary,
      logoUrl: logoUrl || null,
      name: name || null,
      hero: {
        eyebrow: eyebrow || null,
        headline: headline || null,
        subheadline: subheadline || null,
        body: heroBody || null,
        imageUrl: heroImageUrl || null,
        pills: pills.filter((p) => p.label.trim()),
      },
    };
    try {
      const saved = await saveBranding(patch);
      setBranding(saved); // re-tints the whole app immediately
      setMsg({ kind: "ok", text: "Saved. Your branding is live across the app." });
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 403
          ? "You need the Settings (MOD-70) edit permission to change branding."
          : err instanceof ApiError
            ? err.message
            : "Couldn't save. Try again.";
      setMsg({ kind: "err", text });
    } finally {
      setBusy(false);
    }
  }

  async function readAsDataUrl(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read the file"));
      r.readAsDataURL(file);
    });
  }

  async function onFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg({ kind: "err", text: "That's not an image file." });
      return;
    }
    if (file.size > 512_000) {
      setMsg({ kind: "err", text: "Logo must be 512 KB or smaller, or paste a hosted URL instead." });
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { logoUrl: url } = await uploadImage(dataUrl);
      setLogoUrl(url);
      setMsg({ kind: "ok", text: "Logo uploaded — click Save to apply it." });
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 403
          ? "You need the Settings (MOD-70) edit permission to upload."
          : err instanceof ApiError
            ? err.message
            : "Upload failed. Try a smaller image or paste a URL.";
      setMsg({ kind: "err", text });
    } finally {
      setUploading(false);
    }
  }

  async function onHeroFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg({ kind: "err", text: "That's not an image file." });
      return;
    }
    if (file.size > 2_000_000) {
      setMsg({ kind: "err", text: "Hero image must be 2 MB or smaller, or paste a hosted URL instead." });
      return;
    }
    setHeroUploading(true);
    setMsg(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { logoUrl: url } = await uploadImage(dataUrl);
      setHeroImageUrl(url);
      setMsg({ kind: "ok", text: "Hero image uploaded — click Save to apply it." });
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 403
          ? "You need the Settings (MOD-70) edit permission to upload."
          : err instanceof ApiError
            ? err.message
            : "Upload failed. Try a smaller image or paste a URL.";
      setMsg({ kind: "err", text });
    } finally {
      setHeroUploading(false);
    }
  }

  function updatePill(i: number, patch: Partial<BrandPill>) {
    setPills((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  return (
    <section className="mx-auto max-w-3xl animate-fade-in">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Appearance</h1>
        <p className="mt-1 text-sm text-muted-foreground">White-label your workspace. Changes apply instantly.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brand</CardTitle>
            <CardDescription>Colour, logo, and the name shown on the login screen.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSave} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="primary">Primary colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="primary"
                    type="color"
                    value={primary}
                    onChange={(e) => setPrimary(e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                  />
                  <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="max-w-[140px]" />
                  <div className="flex gap-1.5">
                    {PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        onClick={() => setPrimary(c)}
                        className="h-6 w-6 rounded-full border"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smart Logistics" />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Logo</Label>
                <label
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onFile(e.dataTransfer.files?.[0]);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:bg-accent/40"
                >
                  {logoUrl ? (
                    <img src={logoUrl} alt="" className="h-8 w-auto rounded" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-muted">🖼</span>
                  )}
                  <span>
                    {uploading ? "Uploading…" : logoUrl ? "Replace logo" : "Drop an image or click to upload"} · PNG/SVG,
                    ≤512 KB
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={logoUrl.startsWith("data:") ? "" : logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="…or paste a hosted URL"
                  />
                  {logoUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLogoUrl("")}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {msg && (
                <p
                  className={
                    msg.kind === "ok"
                      ? "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                      : "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  }
                >
                  {msg.text}
                </p>
              )}

              <div>
                <Button type="submit" loading={busy}>
                  {busy ? "Saving…" : "Save branding"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Live preview */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 text-center">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-12 w-auto" />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-semibold text-white"
                style={{ background: primary }}
              >
                {(name || "P").charAt(0)}
              </div>
            )}
            <div className="text-sm font-medium">{name || "Praxis LS"}</div>
            <button
              type="button"
              className="w-full rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ background: primary }}
            >
              Sign in
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Landing page (pre-auth hero) */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Landing page</CardTitle>
          <CardDescription>
            The cinematic hero shown before sign-in. Every field is optional — anything left blank falls back to clean
            defaults derived from your brand name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eyebrow">Eyebrow</Label>
              <Input
                id="eyebrow"
                value={eyebrow}
                onChange={(e) => setEyebrow(e.target.value)}
                placeholder="Welcome from Africa, The Operational Heartbeat"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="headline">Headline</Label>
              <textarea
                id="headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                rows={2}
                placeholder="The Home of the Perfect Pixie; where beauty becomes an operation."
                className={TEXTAREA_CLASS}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subheadline">Subheadline</Label>
              <textarea
                id="subheadline"
                value={subheadline}
                onChange={(e) => setSubheadline(e.target.value)}
                rows={2}
                placeholder="Behind the scenes of the world's first premium pixie factory…"
                className={TEXTAREA_CLASS}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="heroBody">Body paragraph</Label>
              <textarea
                id="heroBody"
                value={heroBody}
                onChange={(e) => setHeroBody(e.target.value)}
                rows={3}
                placeholder="From our Lagos fulfillment center to doorsteps worldwide…"
                className={TEXTAREA_CLASS}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Background image</Label>
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onHeroFile(e.dataTransfer.files?.[0]);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:bg-accent/40"
              >
                {heroImageUrl ? (
                  <img src={heroImageUrl} alt="" className="h-12 w-20 rounded object-cover" />
                ) : (
                  <span className="flex h-12 w-20 items-center justify-center rounded bg-muted">🖼</span>
                )}
                <span>
                  {heroUploading ? "Uploading…" : heroImageUrl ? "Replace image" : "Drop an image or click to upload"} ·
                  JPG/PNG, ≤2 MB
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onHeroFile(e.target.files?.[0])}
                />
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={heroImageUrl.startsWith("data:") ? "" : heroImageUrl}
                  onChange={(e) => setHeroImageUrl(e.target.value)}
                  placeholder="…or paste a hosted image URL"
                />
                {heroImageUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setHeroImageUrl("")}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Brand chips</Label>
              <p className="-mt-1 text-xs text-muted-foreground">
                Small partner/sub-brand pills shown on the hero (e.g. the lines you operate).
              </p>
              <div className="flex flex-col gap-2">
                {pills.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={p.label}
                      onChange={(e) => updatePill(i, { label: e.target.value })}
                      placeholder="Faitlyn Hair"
                      className="max-w-[220px]"
                    />
                    <Input
                      value={p.iconUrl || ""}
                      onChange={(e) => updatePill(i, { iconUrl: e.target.value || null })}
                      placeholder="Icon URL (optional)"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPills((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                {pills.length < 6 && (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPills((prev) => [...prev, { label: "", iconUrl: null }])}
                    >
                      + Add chip
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Button type="button" loading={busy} onClick={() => onSave()}>
                {busy ? "Saving…" : "Save landing page"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

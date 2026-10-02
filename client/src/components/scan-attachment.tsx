/**
 * ScanAttachment — the one control for putting a PDF or a photograph behind a
 * record, and for opening it again afterwards.
 *
 * WHY IT IS SHARED. Every master-data register keeps documents as two separate
 * things: the RECORD (type, number, issuing authority, expiry — what the
 * renewals engine reads) and the FILE (the scan itself, which lives in the
 * document vault, MOD-64). The record can exist without the file; that is
 * deliberate, since refusing to register a certificate you are holding because
 * it has not been scanned yet is how a register ends up incomplete.
 *
 * The upload is two calls and always will be: the vault owns the bytes, hashes
 * them and audits them, and the document record only points at the result. This
 * component does the first call and hands back the id; the caller patches it
 * onto its own record, because only the caller knows what that record is.
 *
 * SHAPE OF THE CONTROL. Tom's redesign (2026-10): what sits in the table row is
 * `[View] [⟳]` — View as a real button (it is a primary action, not a text
 * link), Replace as an icon-only button beside it. Clicking Replace opens a
 * Modal whose body is the full `<FileDrop>` — drag, browse, paste, preview,
 * 0→100% percentage, "Upload complete". That is the SAME upload engine
 * (`useUpload` + `uploadVaultFile`) every other site uses; the modal is a
 * surface, not a second engine. Empty rows show one `Attach scan` button that
 * opens the same modal, so the same affordance covers both states.
 */
import * as React from "react";
import * as api from "@/lib/masterdata-api";
import {
  SCAN_ACCEPT,
  openVaultDoc,
  scanFileProblem,
} from "@/lib/vault-file";
import { errMsg } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FileDrop, fileDropProps } from "@/components/ui/file-drop";
import { EyeIcon, RefreshIcon, UploadIcon } from "@/components/ui/icons";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { useUpload } from "@/lib/use-upload";
import { tr } from "@/lib/i18n";

/** 36px bordered icon button — matches the Button `sm` height so View and
 *  Replace share one baseline in the row. */
const iconBtnCls =
  "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export function ScanAttachment({
  vaultId,
  docType,
  entityRef,
  onAttached,
  onError,
  disabled,
  labelWhenEmpty = "Attach scan",
  compact = false,
  openRef,
}: {
  /** The vault id already on the record, if it has been scanned. */
  vaultId?: string | null;
  /**
   * The vault's own doc type — NOT the master-data document type.
   *
   * These two are easy to conflate and the difference has teeth: reading a
   * vaulted file is gated on the module that owns its `doc_type`
   * (`moduleKeyForDocType`), and anything unregistered falls back to MOD-70,
   * the Settings grant. Passing a party document type code like
   * "TAX_CLEARANCE" through here would therefore file the scan under a type the
   * vault has never heard of and demand Settings to open it. Pass the
   * registered owner code — ENTITY_DOCUMENT, CLIENT_DOCUMENT,
   * SUPPLIER_DOCUMENT — and let the record keep its own type.
   */
  docType: string;
  /** `<table>:<id>` of the record the file belongs to, so a file found from the
   *  vault side can be traced back to its owner. */
  entityRef: string;
  /** Patch the returned vault id onto the record. Awaited — the row is not
   *  refreshed until it resolves. */
  onAttached: (vaultId: string) => void | Promise<void>;
  /** Called with the message when something fails, and with `null` when a fresh
   *  attempt starts — so a stale error does not outlive the retry that fixed it. */
  onError?: (message: string | null) => void;
  disabled?: boolean;
  labelWhenEmpty?: string;
  /**
   * Hides the Replace icon from the row and routes it through the card's `⋯`
   * menu instead — the phone card has room for one primary control, not two.
   */
  compact?: boolean;
  /**
   * Hands the caller a function that opens the Replace modal, so a card's
   * action menu can offer "Replace file" without a duplicate control in the
   * row. Already the pattern in `ScanCardActions`.
   */
  openRef?: React.Ref<() => void>;
}) {
  const [busy, setBusy] = React.useState<"open" | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  /**
   * Through the engine, so this control compresses and previews like every
   * other upload. `profile: "document"`: these are certificate and licence
   * scans, so they are downscaled and re-encoded but never tonally corrected.
   *
   * The modal closes itself once the server has answered — the row is already
   * refreshed by that point (its `onAttached` is awaited).
   */
  const upload = useUpload<{ doc_id: string }>({
    profile: "document",
    send: (file, ctx) =>
      api.uploadVaultFile(
        file,
        { doc_type: docType, entity_ref: entityRef, original_name: file.name },
        ctx,
      ),
    onAllComplete: async ([vaulted]) => {
      if (vaulted) {
        await onAttached(vaulted.doc_id);
        setModalOpen(false);
      }
    },
  });

  const item = upload.items[0] ?? null;

  // The engine reports failures per item; this control's contract is a single
  // onError callback, so mirror it across rather than making callers read both.
  React.useEffect(() => {
    if (item?.state === "error" && item.error) onError?.(item.error);
  }, [item?.state, item?.error, onError]);

  const openModal = React.useCallback(() => {
    if (disabled) return;
    onError?.(null);
    upload.reset();
    setModalOpen(true);
  }, [disabled, onError, upload]);

  React.useImperativeHandle(openRef, () => openModal, [openModal]);

  function pick(file: File | null) {
    if (!file) {
      upload.reset();
      return;
    }
    const problem = scanFileProblem(file);
    if (problem) return onError?.(problem);
    onError?.(null);
    void upload.pick([file]);
  }

  async function openScan() {
    if (!vaultId) return;
    setBusy("open");
    try {
      await openVaultDoc(vaultId);
    } catch (e) {
      onError?.(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const replaceLabel = tr("Replace");
  const attachLabel = tr(labelWhenEmpty);
  const modalTitle = vaultId ? tr("Replace file") : attachLabel;

  return (
    <>
      <span className="inline-flex items-center gap-2">
        {vaultId ? (
          <>
            <Button
              size="sm"
              variant="outline"
              icon={<EyeIcon width={14} height={14} />}
              onClick={() => void openScan()}
              disabled={busy !== null}
            >
              {busy === "open" ? tr("Opening…") : tr("View")}
            </Button>
            {!compact && (
              <button
                type="button"
                className={iconBtnCls}
                aria-label={replaceLabel}
                title={replaceLabel}
                onClick={openModal}
                disabled={disabled}
              >
                <RefreshIcon width={16} height={16} />
              </button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            icon={<UploadIcon width={14} height={14} />}
            onClick={openModal}
            disabled={disabled}
          >
            {attachLabel}
          </Button>
        )}
      </span>
      {modalOpen && (
        <Modal
          open
          onClose={() => setModalOpen(false)}
          title={modalTitle}
          size="lg"
        >
          {/* The engine's own surface — dropzone, browse, paste, preview and
              the 0→100% percentage — reused as-is, so the modal is a surface
              and not a second engine. */}
          {/* The modal's own `<h2>` already names the action — FileDrop's own
              label would duplicate it. Keeping it unset leaves the input's
              aria-label at the default "File", which the dialog's labelledby
              link to the h2 already specialises. */}
          <FileDrop
            {...fileDropProps(item)}
            onPick={pick}
            accept={SCAN_ACCEPT}
            hint={tr("PDF or a clear photo. 25 MB maximum.")}
            disabled={
              disabled ||
              item?.state === "uploading" ||
              item?.state === "compressing"
            }
          />
        </Modal>
      )}
    </>
  );
}

/**
 * ScanCardActions — `<ScanAttachment compact>` plus the `⋯` menu, as one unit.
 *
 * This is the phone-card action cluster. The two halves are not independent: the
 * menu's "Replace file" drives the attachment's modal through a ref, and the
 * attachment's visible control changes with the same fact ("is there a file
 * yet?") that decides whether "Replace" belongs in the menu at all. Split
 * across two call sites, that pairing is three things to keep in step on every
 * screen that grows a card row.
 *
 * The order is the one the app uses everywhere: the primary action visible, the
 * rest behind `⋯`. The FILE action leads the menu — it is the fact about this
 * row's content, the way "Open" leads a file manager's menu — the caller's own
 * items follow after a separator, and the caller puts anything destructive last
 * in its own group.
 *
 * @example
 * <ScanCardActions
 *   vaultId={doc.vault_id}
 *   docType="CLIENT_DOCUMENT"
 *   entityRef={`client_document:${doc.document_id}`}
 *   onAttached={(id) => linkScan(doc, id)}
 *   onError={setError}
 *   menuItems={<DropdownItem onSelect={verify}>Verify</DropdownItem>}
 * />
 */
export function ScanCardActions({
  vaultId,
  docType,
  entityRef,
  onAttached,
  onError,
  disabled,
  labelWhenEmpty = "Attach scan",
  menuLabel,
  menuItems,
}: {
  vaultId?: string | null;
  docType: string;
  entityRef: string;
  onAttached: (vaultId: string) => void | Promise<void>;
  onError?: (message: string | null) => void;
  disabled?: boolean;
  labelWhenEmpty?: string;
  /** Accessible name of the menu ("Document actions"). */
  menuLabel: string;
  /** The caller's own items — Verify, Edit, Remove — rendered after the file
   *  action under a separator. */
  menuItems?: React.ReactNode;
}) {
  const openRef = React.useRef<(() => void) | null>(null);

  return (
    <>
      <ScanAttachment
        compact
        vaultId={vaultId}
        docType={docType}
        entityRef={entityRef}
        onAttached={onAttached}
        onError={onError}
        disabled={disabled}
        labelWhenEmpty={labelWhenEmpty}
        openRef={openRef}
      />
      <MoreMenu label={menuLabel} disabled={disabled}>
        <DropdownItem onSelect={() => openRef.current?.()}>
          {vaultId ? tr("Replace file") : tr(labelWhenEmpty)}
        </DropdownItem>
        {menuItems && <DropdownSeparator />}
        {menuItems}
      </MoreMenu>
    </>
  );
}

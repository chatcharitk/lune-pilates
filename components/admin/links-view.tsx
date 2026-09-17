"use client";

// Settings → Links & images.
//
// Two jobs, both in service of the LINE rich menu (owner, 2026-09-17): the ADDRESSES
// of the customer screens, ready to paste into a rich-menu button, and somewhere to
// put an image and get a link back for it.
//
// Every link is shown as an absolute URL built from the origin the admin is browsing
// — paste what you see. The page never guesses a production domain: if the owner is
// on localhost, the copy says localhost, which is the truthful thing to show and
// stops a staging link being pasted into a live menu by accident.

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Drawer } from "./ui";
import {
  deleteUpload,
  saveUpload,
  type AdminUpload,
  type UploadFailureCode,
} from "@/app/actions/admin-uploads";
import type { StrKey } from "@/lib/i18n";

/** The customer screens worth pointing a rich-menu button at. */
const CUSTOMER_LINKS: { path: string; labelKey: StrKey; descKey: StrKey }[] = [
  { path: "/schedule", labelKey: "links_schedule", descKey: "links_schedule_desc" },
  { path: "/buy", labelKey: "links_buy", descKey: "links_buy_desc" },
  { path: "/bookings", labelKey: "links_bookings", descKey: "links_bookings_desc" },
  { path: "/home", labelKey: "links_home", descKey: "links_home_desc" },
  { path: "/profile", labelKey: "links_profile", descKey: "links_profile_desc" },
];

/** Guard before decoding: anything past this is not a rich-menu image. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function uploadErrorKey(code: UploadFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "TOO_LARGE":
      return "err_upload_too_large";
    case "INVALID_FILE":
      return "err_upload_invalid";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_upload_save";
  }
}

/** A byte count as the owner reads it. */
function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LinksView({ uploads, origin }: { uploads: AdminUpload[]; origin: string }) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [toast, setToast] = useState<StrKey | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [deleting, setDeleting] = useState<AdminUpload | null>(null);
  const [pending, startTransition] = useTransition();
  const fileId = useId();

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 2200);
  }

  /** Copy, with the clipboard's own failure surfaced rather than swallowed. */
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash("links_copied");
    } catch {
      setErrorKey("err_copy_failed");
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the input so picking the SAME file again still fires a change event.
    e.target.value = "";
    if (!file) return;
    setErrorKey(null);
    if (!file.type.startsWith("image/") || file.size > MAX_SOURCE_BYTES) {
      setErrorKey("err_upload_invalid");
      return;
    }
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) {
      setErrorKey("err_upload_invalid");
      return;
    }
    // The file's own name is the default title: it is what the owner recognises, and
    // it saves a form nobody wants to fill in before seeing the link.
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "image";
    startTransition(async () => {
      try {
        const res = await saveUpload({ title, dataUrl });
        if (res.ok) {
          flash("links_uploaded");
          router.refresh();
        } else {
          setErrorKey(uploadErrorKey(res.code));
        }
      } catch {
        setErrorKey("err_upload_save");
      }
    });
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("settings_links_title")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] leading-relaxed text-muted">
          {t("settings_links_desc")}
        </p>
      </div>

      {toast && (
        <p
          role="status"
          className="mb-3 rounded-xl bg-sage/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-sage-deep"
        >
          {t(toast)}
        </p>
      )}
      {errorKey && (
        <p
          role="alert"
          className="mb-3 rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
        >
          {t(errorKey)}
        </p>
      )}

      {/* ── the customer screens, as addresses ── */}
      <section className="mb-7">
        <h2 className="mb-1.5 font-body text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
          {t("links_pages_title")}
        </h2>
        <p className="mb-2.5 font-body text-[12.5px] leading-snug text-muted">
          {t("links_pages_hint")}
        </p>
        <ul className="flex flex-col gap-2">
          {CUSTOMER_LINKS.map((l) => (
            <li
              key={l.path}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-body text-[14px] font-semibold text-ink">
                  {t(l.labelKey)}
                </span>
                <span className="mt-0.5 block font-body text-[12px] leading-snug text-muted">
                  {t(l.descKey)}
                </span>
                <code className="mt-1 block truncate font-mono text-[12px] text-taupe-deep">
                  {origin}
                  {l.path}
                </code>
              </span>
              <button
                type="button"
                onClick={() => copy(`${origin}${l.path}`)}
                className="inline-flex h-9 shrink-0 items-center rounded-lg border border-line-strong px-3 font-body text-[13px] font-semibold text-ink"
              >
                {t("links_copy")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ── images ── */}
      <section>
        <h2 className="mb-1.5 font-body text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
          {t("links_images_title")}
        </h2>
        <p className="mb-2.5 font-body text-[12.5px] leading-snug text-muted">
          {t("links_images_hint")}
        </p>

        <label
          htmlFor={fileId}
          className={`mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-2 px-4 py-5 font-body text-sm font-semibold text-ink transition-colors hover:bg-cream-2/50 ${
            pending ? "opacity-50" : ""
          }`}
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          {pending ? t("loading") : t("links_upload")}
        </label>
        <input
          id={fileId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onPick}
          disabled={pending}
          className="sr-only"
        />

        {uploads.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-3.5 py-6 text-center font-body text-[13px] text-muted">
            {t("links_images_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {uploads.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our
                    own route with an unknown intrinsic size; the optimizer adds
                    nothing for an admin-only thumbnail. */}
                <img
                  src={u.path}
                  alt={u.title}
                  className="h-14 w-20 shrink-0 rounded-lg border border-line object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-[14px] font-semibold text-ink">
                    {u.title}
                  </span>
                  <span className="mt-0.5 block font-body text-[12px] text-muted">
                    {sizeLabel(u.sizeBytes)}
                  </span>
                  <code className="mt-1 block truncate font-mono text-[12px] text-taupe-deep">
                    {origin}
                    {u.path}
                  </code>
                </span>
                <span className="flex shrink-0 flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => copy(`${origin}${u.path}`)}
                    className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 font-body text-[13px] font-semibold text-ink"
                  >
                    {t("links_copy")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(u)}
                    className="inline-flex h-9 items-center rounded-lg border border-line px-3 font-body text-[13px] font-semibold text-[#a56a52]"
                  >
                    {t("links_delete")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeleteUploadDrawer
        item={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          flash("links_deleted");
          router.refresh();
        }}
      />
    </div>
  );
}

// ───────────────────────── delete confirmation ─────────────────────────

function DeleteUploadDrawer({
  item,
  onClose,
  onDeleted,
}: {
  item: AdminUpload | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useAdminLang();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  useEffect(() => {
    if (item) setErrorKey(null);
  }, [item]);

  function confirm() {
    if (!item) return;
    setErrorKey(null);
    startTransition(async () => {
      try {
        const res = await deleteUpload(item.id);
        if (res.ok) onDeleted();
        else setErrorKey(uploadErrorKey(res.code));
      } catch {
        setErrorKey("err_upload_save");
      }
    });
  }

  const footer = (
    <>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 font-body text-sm font-semibold text-ink"
      >
        {t("cancel")}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-xl bg-[#a56a52] px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("links_delete")}
      </button>
    </>
  );

  return (
    <Drawer open={item !== null} onClose={onClose} title={t("links_delete")} footer={footer}>
      {item && (
        <div className="flex flex-col gap-3.5">
          <p className="font-head text-lg font-semibold text-ink">{item.title}</p>
          <p className="font-body text-[14px] leading-relaxed text-ink">
            {t("links_delete_confirm")}
          </p>
          {errorKey && (
            <p
              role="alert"
              className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
            >
              {t(errorKey)}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

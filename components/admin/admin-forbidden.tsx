"use client";

// Bilingual 403 fallback for an admin-gated page reached by a non-admin. Rendered
// inside AdminLangProvider (the admin layout's shell), so it reads the active
// language. The v1 mock admin always authorises, so this path is only hit under
// ADMIN_AUTH=deny or a real provider — but the copy is keyed all the same (§6).
import { useAdminLang } from "./admin-context";

export function AdminForbidden() {
  const { t } = useAdminLang();
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-head text-lg font-semibold text-ink">403</p>
      <p className="mt-1 font-body text-sm text-muted">{t("admin_forbidden")}</p>
    </div>
  );
}

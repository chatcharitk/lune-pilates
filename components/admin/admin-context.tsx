"use client";

// Shared admin language context. The admin shell (admin-shell.tsx) holds the
// EN/TH toggle; every admin screen reads the active language from here so the
// nav, chrome and page content switch together — mirroring the prototype's
// AdminCtx (admin-shell.jsx). Customer i18n defaults to EN with no toggle; the
// admin app is internal, so a live toggle is worth the small client context.

import { createContext, useContext, useEffect, useState } from "react";
import { makeT, type Lang, type Translator } from "@/lib/i18n";

interface AdminLangValue extends Translator {
  setLang: (lang: Lang) => void;
}

const AdminLangContext = createContext<AdminLangValue | null>(null);

export function AdminLangProvider({
  children,
  initialLang = "en",
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);

  // Keep <html lang> in sync with the active admin language (finding I2): assistive
  // tech and the browser pick the right language + font fallback.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value: AdminLangValue = { ...makeT(lang), setLang };
  return <AdminLangContext.Provider value={value}>{children}</AdminLangContext.Provider>;
}

/** Active admin language + t()/tt() helpers + setLang. */
export function useAdminLang(): AdminLangValue {
  const ctx = useContext(AdminLangContext);
  if (!ctx) {
    throw new Error("useAdminLang must be used within an AdminLangProvider");
  }
  return ctx;
}

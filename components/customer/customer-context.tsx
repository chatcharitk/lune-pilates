"use client";

// Shared customer language context. The customer Header (header.tsx) holds the
// EN/TH toggle; every customer screen reads the active language from here so the
// chrome (brand header, bottom nav) and page content switch together — mirroring
// the admin app's AdminLangProvider (admin-context.tsx) and the prototype's
// useLune() (lune-ui.jsx).
//
// Customer state is client-only (v1 has no per-user locale persistence on the
// server). We default to EN, but remember the last choice in localStorage so a
// reload keeps the reader's language, and we reflect the active language on the
// <html lang> attribute for assistive tech and the correct font fallback
// (finding I2).

import { createContext, useContext, useEffect, useState } from "react";
import { makeT, type Lang, type Translator } from "@/lib/i18n";

interface CustomerLangValue extends Translator {
  setLang: (lang: Lang) => void;
}

const CustomerLangContext = createContext<CustomerLangValue | null>(null);

const STORAGE_KEY = "lune.lang";

/** A valid Lang or null — guards the value read back from localStorage. */
function parseLang(value: string | null): Lang | null {
  return value === "en" || value === "th" ? value : null;
}

export function CustomerLangProvider({
  children,
  initialLang = "en",
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  // On mount, restore the remembered language (if any). Done in an effect so the
  // server-rendered markup (always `initialLang`) and the first client paint
  // match — no hydration mismatch — then we upgrade to the saved choice.
  useEffect(() => {
    const saved = parseLang(window.localStorage.getItem(STORAGE_KEY));
    if (saved && saved !== lang) setLangState(saved);
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang> in sync with the active language (finding I2): assistive
  // tech and the browser pick the right language + font fallback.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function setLang(next: Lang) {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — language still switches in-session.
    }
  }

  const value: CustomerLangValue = { ...makeT(lang), setLang };
  return <CustomerLangContext.Provider value={value}>{children}</CustomerLangContext.Provider>;
}

/** Active customer language + t()/tt() helpers + setLang. */
export function useCustomerLang(): CustomerLangValue {
  const ctx = useContext(CustomerLangContext);
  if (!ctx) {
    throw new Error("useCustomerLang must be used within a CustomerLangProvider");
  }
  return ctx;
}

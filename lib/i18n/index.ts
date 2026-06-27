// i18n helpers mirroring the prototype's t()/tt() pattern.
//   t(key)        → a catalog UI string in the active language
//   tt({en,th})   → a bilingual content object in the active language

import { STR, type Bilingual, type Lang, type StrKey } from "./strings";

export type { Lang, Bilingual, StrKey };
export { STR };

export interface Translator {
  lang: Lang;
  t: (key: StrKey) => string;
  tt: (obj: Bilingual | null | undefined) => string;
}

export function makeT(lang: Lang): Translator {
  return {
    lang,
    t: (key) => STR[key][lang] ?? STR[key].en,
    tt: (obj) => (obj ? (obj[lang] ?? obj.en) : ""),
  };
}

/** Thai Baht formatter, matching the prototype's thb(). */
export function thb(n: number): string {
  return "฿" + n.toLocaleString("en-US");
}

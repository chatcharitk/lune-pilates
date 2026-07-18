// Normalize a Thai mobile number to the canonical stored form: 10 digits with a
// leading 0 (e.g. "0812345678") — the same shape the seed + admin "create customer"
// use, so LINE-login phone-matching lines up with front-desk-created records.
//
// Accepts common inputs: with spaces/dashes, or the +66 / 66 international prefix.
// Returns null for anything that isn't a valid 10-digit Thai mobile — the caller
// then treats it as "no match / invalid" rather than guessing.

export function normalizeThaiPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let d = digits;
  // +66 8xxxxxxxx  → 66 8xxxxxxxx (11 digits) → 0 8xxxxxxxx
  if (d.startsWith("66") && d.length === 11) d = "0" + d.slice(2);
  // 660xxxxxxxxx (someone typed +660...) → 0xxxxxxxxx
  else if (d.startsWith("660") && d.length === 12) d = "0" + d.slice(3);
  return /^0\d{9}$/.test(d) ? d : null;
}

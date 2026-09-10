// Server-side validation of an uploaded instructor photo
// (lib/images/avatarImage.ts).
//
// The value this guards ends up written straight into an <img src> for every admin,
// so the DECLARED type in the data URL is never trusted — the real type is sniffed
// from the bytes, and what gets stored is rebuilt from those bytes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_AVATAR_BYTES,
  canonicalAvatarDataUrl,
  validateAvatarDataUrl,
} from "@/lib/images/avatarImage";

/** A real 1x1 image of each accepted type. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function dataUrl(mime: string, b64: string): string {
  return `data:${mime};base64,${b64}`;
}

describe("validateAvatarDataUrl", () => {
  it("accepts a real PNG and reports its sniffed type", () => {
    const res = validateAvatarDataUrl(dataUrl("image/png", PNG_B64));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mimeType).toBe("image/png");
    expect(res.sizeBytes).toBeGreaterThan(0);
  });

  it("accepts a real JPEG", () => {
    const res = validateAvatarDataUrl(dataUrl("image/jpeg", JPEG_B64));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mimeType).toBe("image/jpeg");
  });

  it("believes the BYTES, not the declared type", () => {
    // A PNG announced as JPEG is still stored as a PNG — the header is caller-
    // controlled, the magic bytes are not.
    const res = validateAvatarDataUrl(dataUrl("image/jpeg", PNG_B64));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mimeType).toBe("image/png");
  });

  it("rejects a non-image dressed up as one", () => {
    const script = Buffer.from("<script>alert(1)</script>").toString("base64");
    expect(validateAvatarDataUrl(dataUrl("image/png", script))).toEqual({
      ok: false,
      code: "INVALID_FILE",
    });
  });

  it.each([
    ["not a data URL", "https://example.com/cat.png"],
    ["empty payload", "data:image/png;base64,"],
    ["a bare string", "hello"],
    ["an SVG (scriptable, never accepted)", `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`],
  ])("rejects %s", (_label, input) => {
    expect(validateAvatarDataUrl(input)).toEqual({ ok: false, code: "INVALID_FILE" });
  });

  it("rejects anything past the size cap before it can reach a row", () => {
    // A valid PNG header followed by enough padding to blow the cap.
    const big = Buffer.concat([
      Buffer.from(PNG_B64, "base64"),
      Buffer.alloc(MAX_AVATAR_BYTES + 1024, 0),
    ]);
    const res = validateAvatarDataUrl(dataUrl("image/png", big.toString("base64")));
    expect(res).toEqual({ ok: false, code: "TOO_LARGE" });
  });
});

describe("canonicalAvatarDataUrl", () => {
  it("rebuilds the stored value from the decoded bytes and sniffed type", () => {
    // Input lies about the type; the stored URL must not repeat the lie.
    const res = validateAvatarDataUrl(dataUrl("image/webp", PNG_B64));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stored = canonicalAvatarDataUrl(res);
    expect(stored.startsWith("data:image/png;base64,")).toBe(true);
    // And it round-trips to the same bytes.
    expect(validateAvatarDataUrl(stored)).toMatchObject({ ok: true, mimeType: "image/png" });
  });
});

// ───────────────────────── the action's own gate ─────────────────────────
// Run with no DATABASE_URL, so these exercise validation + the owner gate without
// touching a database (the write itself is verified against the real DB).

import { setInstructorPhoto } from "@/app/actions/instructors";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_ROLE = process.env.ADMIN_ROLE;

describe("setInstructorPhoto", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.ADMIN_ROLE; // mock provider's default role is owner
  });
  afterEach(() => {
    if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB_URL;
    if (ORIGINAL_ADMIN_ROLE === undefined) delete process.env.ADMIN_ROLE;
    else process.env.ADMIN_ROLE = ORIGINAL_ADMIN_ROLE;
  });

  it("accepts null to CLEAR the photo", async () => {
    // The remove path: null must survive validation rather than being rejected as
    // an empty string, or the button would silently do nothing.
    const res = await setInstructorPhoto({ id: "mai", photoDataUrl: null });
    expect(res).toEqual({ ok: true, id: "mai", photoUrl: null });
  });

  it("stores a canonical data URL rebuilt from the decoded bytes", async () => {
    const res = await setInstructorPhoto({
      id: "mai",
      photoDataUrl: dataUrl("image/webp", PNG_B64), // lies about its type
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.photoUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects a non-image", async () => {
    const junk = Buffer.from("not an image at all").toString("base64");
    const res = await setInstructorPhoto({ id: "mai", photoDataUrl: dataUrl("image/png", junk) });
    expect(res).toEqual({ ok: false, code: "INVALID_FILE" });
  });

  it("is owner-only — an instructor cannot change photos", async () => {
    process.env.ADMIN_ROLE = "instructor";
    const res = await setInstructorPhoto({ id: "mai", photoDataUrl: null });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("rejects an unauthorised caller BEFORE looking at the input", async () => {
    process.env.ADMIN_ROLE = "instructor";
    const res = await setInstructorPhoto({ id: "", photoDataUrl: "garbage" });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});

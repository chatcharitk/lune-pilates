// The rule that keeps a PUBLIC image route safe: what is stored is what the bytes
// actually are, never what the uploader said they were.

import { describe, expect, it } from "vitest";
import { canonicalUploadDataUrl, validateUploadDataUrl, MAX_UPLOAD_BYTES } from "@/lib/images/upload";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

describe("validateUploadDataUrl", () => {
  it("accepts a real PNG", () => {
    const res = validateUploadDataUrl(dataUrl("image/png", PNG_HEADER));
    expect(res.ok && res.mimeType).toBe("image/png");
  });

  it("believes the BYTES, not the declared type", () => {
    // A JPEG announced as a PNG is stored as the JPEG it is, so the public route
    // cannot be talked into serving one thing as another.
    const res = validateUploadDataUrl(dataUrl("image/png", JPEG_HEADER));
    expect(res.ok && res.mimeType).toBe("image/jpeg");
  });

  it("refuses a file that is not an image at all", () => {
    const res = validateUploadDataUrl(dataUrl("image/png", Buffer.from("<script>alert(1)</script>")));
    expect(res).toEqual({ ok: false, code: "INVALID_FILE" });
  });

  it("refuses an SVG, which a browser would execute", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(validateUploadDataUrl(dataUrl("image/svg+xml", svg))).toEqual({
      ok: false,
      code: "INVALID_FILE",
    });
  });

  it("refuses anything past the cap", () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_UPLOAD_BYTES + 1)]);
    expect(validateUploadDataUrl(dataUrl("image/png", big))).toEqual({
      ok: false,
      code: "TOO_LARGE",
    });
  });

  it("refuses a string that is not a data URL", () => {
    expect(validateUploadDataUrl("https://example.com/cat.png")).toEqual({
      ok: false,
      code: "INVALID_FILE",
    });
    expect(validateUploadDataUrl("")).toEqual({ ok: false, code: "INVALID_FILE" });
  });

  it("rebuilds the stored string from the sniffed type", () => {
    const res = validateUploadDataUrl(dataUrl("image/png", JPEG_HEADER));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(canonicalUploadDataUrl(res)).toBe(dataUrl("image/jpeg", JPEG_HEADER));
  });
});

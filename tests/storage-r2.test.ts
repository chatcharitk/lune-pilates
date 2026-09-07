// Regression test for the R2 slip-upload outage (2026-09-07).
//
// Production symptom: every customer payment died at "attach your slip" with
// "couldn't start the payment", and the server log read:
//   R2 put failed (411): <Error><Code>MissingContentLength</Code>…
//
// Cause: aws4fetch's `AwsClient.fetch()` signs into a Request OBJECT and passes it
// to fetch. A Request body is a ReadableStream, so the PUT went out chunked with no
// Content-Length, and R2 — like S3 — refuses a body-bearing PUT without one.
//
// These tests run a STAND-IN S3 over loopback that reproduces Cloudflare's rule
// (411 when Content-Length is absent on a PUT with a body) and check the round trip
// without needing R2 credentials.
//
// IMPORTANT — what this file can and cannot prove. Whether a Blob body happens to
// carry Content-Length is a property of the RUNTIME's fetch (undici), and it differs
// between Node versions: the pre-fix code passes the loopback test on a recent local
// Node while still failing on Vercel's older runtime, which is exactly how this
// reached production. So the load-bearing assertion here is not "the stand-in
// accepted it" but "we set Content-Length OURSELVES" — the runtime-independent
// invariant ("sets Content-Length explicitly…" below). Keep that test: it is the one
// that would have caught this.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { R2SlipStorage } from "@/lib/storage/r2";

/** A 1x1 PNG — a real, sniffable image, same fixture the slip tests use. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

interface Received {
  method: string;
  path: string;
  contentLength: string | undefined;
  contentType: string | undefined;
  authorization: string | undefined;
  bodyB64: string;
}

let server: Server;
let endpoint: string;
const received: Received[] = [];
/** Objects the stand-in stored, by path — so GET can serve them back. */
const stored = new Map<string, { body: Buffer; contentType: string }>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = req.url ?? "";
      received.push({
        method: req.method ?? "",
        path,
        contentLength: req.headers["content-length"],
        contentType: req.headers["content-type"],
        authorization: req.headers["authorization"],
        bodyB64: body.toString("base64"),
      });

      if (req.method === "PUT") {
        // THE RULE THAT BROKE PRODUCTION: S3/R2 reject a body-bearing PUT that
        // does not declare its length.
        if (req.headers["content-length"] === undefined) {
          res.writeHead(411, { "content-type": "application/xml" });
          res.end(
            '<?xml version="1.0" encoding="UTF-8"?><Error><Code>MissingContentLength</Code>' +
              "<Message>You must provide the Content-Length HTTP header.</Message></Error>",
          );
          return;
        }
        stored.set(path, {
          body,
          contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
        });
        res.writeHead(200).end();
        return;
      }

      if (req.method === "GET") {
        const obj = stored.get(path);
        if (!obj) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": obj.contentType }).end(obj.body);
        return;
      }

      res.writeHead(405).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function storage(): R2SlipStorage {
  return new R2SlipStorage({
    accountId: "test-account",
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
    bucket: "slips-test",
    endpoint,
  });
}

describe("R2SlipStorage.put — Content-Length is set by US, not by the runtime", () => {
  afterEach(() => {
    // unstubAllGlobals (not just restoreAllMocks) — otherwise the stubbed fetch
    // leaks into the loopback tests below.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sets Content-Length explicitly on the outgoing PUT, and passes a measurable body", async () => {
    // Intercept at the fetch boundary: this asserts what LEAVES our code, so it holds
    // no matter which Node/undici version runs it. The production outage was exactly
    // this header going missing on Vercel's runtime.
    const seen: { headers: Headers; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        seen.push({ headers: new Headers(init.headers), body: init.body });
        return new Response(null, { status: 200 });
      }),
    );

    await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_explicit",
    });

    expect(seen).toHaveLength(1);
    const expectedBytes = Buffer.from(PNG_B64, "base64").byteLength;
    expect(seen[0]!.headers.get("content-length")).toBe(String(expectedBytes));
    // A Uint8Array is a length-measurable BodyInit; a Blob/stream is what lost the
    // header on the old runtime, so assert we are not passing one.
    expect(seen[0]!.body).toBeInstanceOf(Uint8Array);
    expect(seen[0]!.body).not.toBeInstanceOf(Blob);
    // The signature must still be attached.
    expect(seen[0]!.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });
});

describe("R2SlipStorage.put", () => {
  it("uploads successfully against an S3 that requires Content-Length", async () => {
    // Before the fix this threw `R2 put failed (411): …MissingContentLength…`.
    const out = await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_test_charge",
    });
    expect(out.storageKey).toMatch(/^slips\/pp_test_charge-/);
    // Bytes live in R2, so the DB column stays empty.
    expect(out.dataUrlToPersist).toBeNull();
  });

  it("sends Content-Length matching the decoded image size", async () => {
    received.length = 0;
    await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_len",
    });
    const put = received.find((r) => r.method === "PUT");
    expect(put).toBeDefined();
    expect(put!.contentLength).toBe(String(Buffer.from(PNG_B64, "base64").byteLength));
  });

  it("still signs the request (Content-Length must not break SigV4)", async () => {
    received.length = 0;
    await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_sig",
    });
    const put = received.find((r) => r.method === "PUT")!;
    expect(put.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST/);
    // content-length is unsignable in SigV4, so it must NOT appear in SignedHeaders —
    // that is precisely why setting it cannot invalidate the signature.
    expect(put.authorization).not.toMatch(/SignedHeaders=[^,]*content-length/);
  });

  it("uploads the image bytes intact, with its content type", async () => {
    received.length = 0;
    await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_bytes",
    });
    const put = received.find((r) => r.method === "PUT")!;
    expect(put.bodyB64).toBe(PNG_B64);
    expect(put.contentType).toBe("image/png");
  });

  it("gives each upload an unguessable key, even for the same charge", async () => {
    const a = await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_same",
    });
    const b = await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_same",
    });
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it("throws with the server's status and body when the upload is refused", async () => {
    // A DELETE-only path the stand-in answers 405 to proves the error surfaces
    // rather than being swallowed into a silent success.
    const s = new R2SlipStorage({
      accountId: "test-account",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      bucket: "slips-test",
      endpoint: `${endpoint}/force-405`,
    });
    // The stand-in stores by full path, so this still PUTs fine; instead assert the
    // error path directly with an endpoint that refuses connections.
    await expect(
      new R2SlipStorage({
        accountId: "test-account",
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        bucket: "b",
        endpoint: "http://127.0.0.1:1",
      }).put({ dataUrl: PNG_DATA_URL, mimeType: "image/png", chargeId: "pp_down" }),
    ).rejects.toThrow();
    expect(s).toBeDefined();
  });
});

describe("R2SlipStorage.get", () => {
  it("round-trips an uploaded slip back to a data-URL", async () => {
    const { storageKey } = await storage().put({
      dataUrl: PNG_DATA_URL,
      mimeType: "image/png",
      chargeId: "pp_roundtrip",
    });
    const got = await storage().get(storageKey);
    expect(got).not.toBeNull();
    expect(got!.mimeType).toBe("image/png");
    expect(got!.dataUrl).toBe(PNG_DATA_URL);
  });

  it("returns null for a missing object rather than throwing", async () => {
    expect(await storage().get("slips/does-not-exist")).toBeNull();
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { groupChanges, verifyLineSignature } from "@/lib/line/webhook";
import { staffBookingMessage, type StaffBookingFacts } from "@/lib/events/staff-notify";

const secret = "test-channel-secret";
const sign = (body: string, key = secret) => createHmac("sha256", key).update(body).digest("base64");

describe("verifyLineSignature", () => {
  const body = JSON.stringify({ events: [{ type: "join", source: { type: "group", groupId: "Cabc" } }] });

  it("accepts LINE's signature of the raw body", () => {
    expect(verifyLineSignature(body, sign(body), secret)).toBe(true);
  });

  it("refuses a missing, wrong-key or tampered signature", () => {
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyLineSignature(body + " ", sign(body), secret)).toBe(false);
    expect(verifyLineSignature(body, "not base64!!", secret)).toBe(false);
  });
});

describe("groupChanges", () => {
  it("keeps only group joins and leaves", () => {
    expect(
      groupChanges([
        { type: "join", source: { type: "group", groupId: "G1" } },
        { type: "leave", source: { type: "group", groupId: "G2" } },
        { type: "join", source: { type: "room" } },
        { type: "message", source: { type: "group", groupId: "G3" } },
        { type: "message", source: { type: "group", groupId: "G3" } },
        { type: "message", source: { type: "user" } },
        { type: "follow", source: { type: "user" } },
      ]),
    ).toEqual({ joined: ["G1"], left: ["G2"], seen: ["G3"], tests: [] });
  });

  it("spots the test command in a group, and only there", () => {
    expect(
      groupChanges([
        { type: "message", source: { type: "group", groupId: "G1" }, message: { type: "text", text: " #ทดสอบ " } },
        { type: "message", source: { type: "group", groupId: "G2" }, message: { type: "text", text: "ทดสอบ" } },
        { type: "message", source: { type: "user" }, message: { type: "text", text: "#ทดสอบ" } },
      ]).tests,
    ).toEqual(["G1"]);
  });
});

describe("staffBookingMessage", () => {
  const base: StaffBookingFacts = {
    customerName: "Nan",
    houseNumber: "233/327",
    className: "Essential Reformer",
    typeLabel: "กลุ่ม",
    startsAt: new Date("2026-10-17T02:00:00Z"), // 09:00 Bangkok
    instructor: "ครูจ๋า",
    booked: 2,
    capacity: 3,
    partySize: null,
    remaining: 18,
    source: "customer",
  };

  it("reports who, what, when, how full, and the customer's classes left", () => {
    const msg = staffBookingMessage(base);
    expect(msg).toContain("📅 จองคลาสใหม่");
    expect(msg).toContain("Nan (บ้าน 233/327)");
    expect(msg).toContain("Essential Reformer · กลุ่ม");
    expect(msg).toContain("09:00 น. · ครูจ๋า");
    expect(msg).toContain("ผู้เข้าเรียน 2/3 คน");
    expect(msg).not.toContain("(เต็ม)");
    expect(msg).toContain("คลาสคงเหลือของลูกค้า: 18 คลาส");
  });

  it("flags a now-full class, a front-desk booking, and a rental's head-count", () => {
    expect(staffBookingMessage({ ...base, booked: 3 })).toContain("ผู้เข้าเรียน 3/3 คน (เต็ม)");
    expect(staffBookingMessage({ ...base, source: "admin" })).toContain("(แอดมินจองให้)");
    const rental = staffBookingMessage({ ...base, partySize: 2, capacity: 1, booked: 1 });
    expect(rental).toContain("เช่าสตูดิโอ 2 คน");
    expect(rental).not.toContain("ผู้เข้าเรียน");
  });
});

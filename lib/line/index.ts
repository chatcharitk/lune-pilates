import type { LineClient } from "./types";
import { MockLineClient } from "./mock";
import { LiveLineClient } from "./live";

let _line: LineClient | null = null;

/**
 * Resolve the LINE client by `LINE_MODE` (CLAUDE.md §2 — LINE Messaging is mocked
 * in v1 behind a clean interface).
 *
 * Fails CLOSED (security finding S1, mirroring the payments factory): the mock
 * only logs. There is no real LINE client wired yet, so any non-"mock" value
 * throws at construction rather than silently degrading to the mock in production.
 *
 *   - unset / "mock" → the v1 mock (default for dev).
 *   - "live" (or any other value) → throw; wire the real LINE client here.
 */
export function getLineClient(): LineClient {
  if (!_line) {
    const mode = process.env.LINE_MODE ?? "mock";
    if (mode === "live") {
      // Real Messaging API client (validates the access token at construction).
      _line = new LiveLineClient();
    } else if (mode === "mock") {
      _line = new MockLineClient();
    } else {
      // Fail closed: an unknown mode must never silently degrade to the mock.
      throw new Error(
        `LINE_MODE=${mode} is not a known mode. Use "mock" (dev) or "live".`,
      );
    }
  }
  return _line;
}

export type { LineClient, FlexBookingCard } from "./types";

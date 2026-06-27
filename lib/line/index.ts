import type { LineClient } from "./types";
import { MockLineClient } from "./mock";

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
    if (mode !== "mock") {
      // When the real LINE Messaging API client is wired, construct it for "live" here.
      throw new Error(
        `LINE_MODE=${mode} but no live LINE client is configured. ` +
          `Set LINE_MODE=mock for v1, or wire a real client in lib/line/index.ts.`,
      );
    }
    _line = new MockLineClient();
  }
  return _line;
}

export type { LineClient, FlexBookingCard } from "./types";

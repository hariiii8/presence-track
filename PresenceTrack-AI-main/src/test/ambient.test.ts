import { describe, expect, it } from "vitest";
import { APP_CONFIG, formatMinutes, isNodeLive, shortHash, todayIST } from "@/lib/ambient";

describe("ambient utility functions", () => {
  it("formats minutes to hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0h 0m");
    expect(formatMinutes(45)).toBe("0h 45m");
    expect(formatMinutes(60)).toBe("1h 0m");
    expect(formatMinutes(135)).toBe("2h 15m");
    expect(formatMinutes(480)).toBe("8h 0m");
  });

  it("truncates hashes with shortHash correctly", () => {
    expect(shortHash(null)).toBe("—");
    expect(shortHash(undefined)).toBe("—");
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("12345678901234567890", 8)).toBe("12345678…");
  });

  it("checks node liveness based on ping window", () => {
    const now = Date.now();
    expect(isNodeLive({ is_online: false, last_ping: new Date(now).toISOString() }, now)).toBe(
      false,
    );
    expect(isNodeLive({ is_online: true, last_ping: null }, now)).toBe(false);
    // Recent ping (30s ago, within 60s window)
    expect(
      isNodeLive({ is_online: true, last_ping: new Date(now - 30_000).toISOString() }, now),
    ).toBe(true);
    // Stale ping (90s ago, beyond 60s window)
    expect(
      isNodeLive({ is_online: true, last_ping: new Date(now - 90_000).toISOString() }, now),
    ).toBe(false);
  });

  it("formats todayIST to YYYY-MM-DD in Asia/Kolkata timezone", () => {
    // 2026-05-10T23:30:00Z -> IST is +05:30 -> 2026-05-11 05:00:00
    const date = new Date("2026-05-10T23:30:00Z");
    expect(todayIST(date)).toBe("2026-05-11");
  });
});

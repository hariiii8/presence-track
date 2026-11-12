import { describe, expect, it } from "vitest";

type TransitEvent = {
  timestamp: string;
  direction: "ZONE_ENTER" | "ZONE_EXIT";
  zone_from: string;
  zone_to: string;
};

/**
 * Pure TypeScript replica of the chronological attendance evaluation logic
 * implemented in the apply_transit() database engine.
 */
function calculateAttendanceFromTransits(transits: TransitEvent[]) {
  // Sort chronologically ascending to guarantee immunity to out-of-order arrivals
  const sorted = [...transits].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let firstIn: string | null = null;
  let lastOut: string | null = null;
  let curState: "OUT" | "WORKSPACE" | "BREAK" = "OUT";
  let stateStart: number | null = null;
  let workMin = 0;
  let breakMin = 0;

  for (const t of sorted) {
    const tTime = new Date(t.timestamp).getTime();

    // Determine First IN
    if (!firstIn && t.direction === "ZONE_ENTER" && t.zone_to === "WORKSPACE_FLOOR") {
      firstIn = t.timestamp;
    }

    // Determine Last OUT
    if (t.direction === "ZONE_EXIT" || t.zone_to === "CORRIDOR_TRANSIT") {
      lastOut = t.timestamp;
    }

    // Accumulate interval
    if (stateStart !== null && tTime > stateStart) {
      const dur = Math.max(0, Math.floor((tTime - stateStart) / 60000));
      if (curState === "WORKSPACE") {
        workMin += dur;
      } else if (curState === "BREAK") {
        breakMin += dur;
      }
    }

    // State transition
    if (t.zone_to === "WORKSPACE_FLOOR") {
      curState = "WORKSPACE";
      stateStart = tTime;
    } else if (t.zone_to === "CAFETERIA_LOUNGE" || t.zone_to === "OUTDOOR_TERRACE") {
      curState = "BREAK";
      stateStart = tTime;
    } else {
      curState = "OUT";
      stateStart = tTime;
    }
  }

  const missedExit = curState === "WORKSPACE" && lastOut === null;
  const status = workMin >= 240 ? "PRESENT" : workMin > 0 ? "HALF_DAY" : "ABSENT";

  return {
    first_in: firstIn,
    last_out: lastOut,
    total_work_minutes: workMin,
    total_break_minutes: breakMin,
    status,
    missed_exit: missedExit,
  };
}

describe("Attendance Calculation Engine", () => {
  it("determines first_in and last_out accurately", () => {
    const events: TransitEvent[] = [
      {
        timestamp: "2026-11-10T09:00:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CORRIDOR_TRANSIT",
        zone_to: "WORKSPACE_FLOOR",
      },
      {
        timestamp: "2026-11-10T17:30:00.000Z",
        direction: "ZONE_EXIT",
        zone_from: "WORKSPACE_FLOOR",
        zone_to: "CORRIDOR_TRANSIT",
      },
    ];

    const res = calculateAttendanceFromTransits(events);
    expect(res.first_in).toBe("2026-11-10T09:00:00.000Z");
    expect(res.last_out).toBe("2026-11-10T17:30:00.000Z");
    expect(res.total_work_minutes).toBe(510); // 8.5 hours = 510 minutes
    expect(res.status).toBe("PRESENT");
    expect(res.missed_exit).toBe(false);
  });

  it("calculates break durations and productive workspace minutes across multiple transitions", () => {
    const events: TransitEvent[] = [
      // 09:00 Enter Workspace
      {
        timestamp: "2026-11-10T09:00:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CORRIDOR_TRANSIT",
        zone_to: "WORKSPACE_FLOOR",
      },
      // 12:00 Exit to Cafeteria (3 hours work = 180 min)
      {
        timestamp: "2026-11-10T12:00:00.000Z",
        direction: "ZONE_EXIT",
        zone_from: "WORKSPACE_FLOOR",
        zone_to: "CAFETERIA_LOUNGE",
      },
      // 12:45 Return to Workspace (45 min break)
      {
        timestamp: "2026-11-10T12:45:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CAFETERIA_LOUNGE",
        zone_to: "WORKSPACE_FLOOR",
      },
      // 17:00 Exit to Corridor (4h 15m work = 255 min)
      {
        timestamp: "2026-11-10T17:00:00.000Z",
        direction: "ZONE_EXIT",
        zone_from: "WORKSPACE_FLOOR",
        zone_to: "CORRIDOR_TRANSIT",
      },
    ];

    const res = calculateAttendanceFromTransits(events);
    expect(res.first_in).toBe("2026-11-10T09:00:00.000Z");
    expect(res.last_out).toBe("2026-11-10T17:00:00.000Z");
    expect(res.total_work_minutes).toBe(180 + 255); // 435 minutes
    expect(res.total_break_minutes).toBe(45);
    expect(res.status).toBe("PRESENT");
  });

  it("handles out-of-order event timestamps from network retry delays", () => {
    // Event arriving late out of order:
    // Event 2 (17:00 exit) received BEFORE Event 1 (12:00 break) due to edge queue
    const unorderedEvents: TransitEvent[] = [
      {
        timestamp: "2026-11-10T09:00:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CORRIDOR_TRANSIT",
        zone_to: "WORKSPACE_FLOOR",
      },
      {
        timestamp: "2026-11-10T17:00:00.000Z",
        direction: "ZONE_EXIT",
        zone_from: "WORKSPACE_FLOOR",
        zone_to: "CORRIDOR_TRANSIT",
      },
      {
        timestamp: "2026-11-10T12:00:00.000Z",
        direction: "ZONE_EXIT",
        zone_from: "WORKSPACE_FLOOR",
        zone_to: "CAFETERIA_LOUNGE",
      },
      {
        timestamp: "2026-11-10T13:00:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CAFETERIA_LOUNGE",
        zone_to: "WORKSPACE_FLOOR",
      },
    ];

    const res = calculateAttendanceFromTransits(unorderedEvents);
    // Chronological sorting should produce exact same 7h work (420 min) and 1h break (60 min)
    expect(res.first_in).toBe("2026-11-10T09:00:00.000Z");
    expect(res.last_out).toBe("2026-11-10T17:00:00.000Z");
    expect(res.total_work_minutes).toBe(420);
    expect(res.total_break_minutes).toBe(60);
    expect(res.status).toBe("PRESENT");
  });

  it("detects missed exit when an employee remains in workspace without exit", () => {
    const singleInEvent: TransitEvent[] = [
      {
        timestamp: "2026-11-10T09:00:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CORRIDOR_TRANSIT",
        zone_to: "WORKSPACE_FLOOR",
      },
    ];

    const res = calculateAttendanceFromTransits(singleInEvent);
    expect(res.first_in).toBe("2026-11-10T09:00:00.000Z");
    expect(res.last_out).toBeNull();
    expect(res.missed_exit).toBe(true);
  });

  it("filters rapid duplicate events within 3 seconds", () => {
    const duplicates: TransitEvent[] = [
      {
        timestamp: "2026-11-10T09:00:00.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CORRIDOR_TRANSIT",
        zone_to: "WORKSPACE_FLOOR",
      },
      // Duplicate packet 1 second later
      {
        timestamp: "2026-11-10T09:00:01.000Z",
        direction: "ZONE_ENTER",
        zone_from: "CORRIDOR_TRANSIT",
        zone_to: "WORKSPACE_FLOOR",
      },
      {
        timestamp: "2026-11-10T12:00:00.000Z",
        direction: "ZONE_EXIT",
        zone_from: "WORKSPACE_FLOOR",
        zone_to: "CORRIDOR_TRANSIT",
      },
    ];

    // Filter duplicates with < 3s threshold
    const deduped: TransitEvent[] = [];
    for (const t of duplicates) {
      const prev = deduped[deduped.length - 1];
      if (
        prev &&
        prev.direction === t.direction &&
        prev.zone_to === t.zone_to &&
        Math.abs(new Date(t.timestamp).getTime() - new Date(prev.timestamp).getTime()) < 3000
      ) {
        continue;
      }
      deduped.push(t);
    }

    expect(deduped).toHaveLength(2);
    const res = calculateAttendanceFromTransits(deduped);
    expect(res.total_work_minutes).toBe(180);
  });
});

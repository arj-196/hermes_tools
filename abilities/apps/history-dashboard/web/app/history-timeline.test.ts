import { describe, expect, it } from "vitest";

import {
  buildTimelineData,
  deriveTimelineRangeFromIndexes,
  filterRecordsByTimelineRange,
  normalizeLookbackInput,
  type RunRecord,
} from "./history-timeline";

function buildRecord(overrides: Partial<RunRecord>): RunRecord {
  return {
    event: "run_finished",
    run_id: "run-id",
    service: "chores",
    command: "bin/chores",
    started_at: "2026-05-10T10:00:00.000Z",
    finished_at: "2026-05-10T10:00:10.000Z",
    duration_ms: 10_000,
    result: "ok",
    exit_code: 0,
    failure_code: null,
    message: null,
    log_path: "/tmp/run.log",
    metadata: {},
    ...overrides,
  };
}

describe("buildTimelineData", () => {
  it("sorts runs chronologically and assigns stable service colors", () => {
    const data = buildTimelineData([
      buildRecord({ run_id: "later", started_at: "2026-05-10T12:00:00.000Z", service: "auto-coder" }),
      buildRecord({ run_id: "earlier", started_at: "2026-05-10T08:00:00.000Z", service: "chores" }),
    ]);

    expect(data.map((entry) => entry.runId)).toEqual(["earlier", "later"]);
    expect(data[0]?.color).toBe("#d97706");
    expect(data[1]?.color).toBe("#175cd3");
  });
});

describe("timeline range helpers", () => {
  it("derives an inclusive range from brush indexes and filters records against it", () => {
    const records = [
      buildRecord({ run_id: "first", started_at: "2026-05-10T08:00:00.000Z" }),
      buildRecord({ run_id: "second", started_at: "2026-05-10T10:00:00.000Z" }),
      buildRecord({ run_id: "third", started_at: "2026-05-10T12:00:00.000Z" }),
    ];

    const data = buildTimelineData(records);
    const range = deriveTimelineRangeFromIndexes(data, 0, 1);

    expect(filterRecordsByTimelineRange(records, range).map((record) => record.run_id)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("normalizeLookbackInput", () => {
  it("clamps invalid numeric input into the supported range", () => {
    expect(normalizeLookbackInput("0")).toBe(1);
    expect(normalizeLookbackInput("999")).toBe(90);
    expect(normalizeLookbackInput("bad-value")).toBe(7);
  });
});

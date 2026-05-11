import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getAllRunHistory,
  MAX_HISTORY_LOOKBACK_DAYS,
  normalizeLookbackDays,
} from "./observability";

const ORIGINAL_ROBIN_HOME = process.env.ROBIN_HOME;
const ORIGINAL_RUN_LEDGER_DIR = process.env.ROBIN_RUN_LEDGER_DIR;

const tempDirs: string[] = [];

function writeLedger(lines: unknown[]): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "robin-history-dashboard-"));
  tempDirs.push(root);

  const ledgerDir = path.join(root, "run-ledger");
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerDir, "run-ledger.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );

  process.env.ROBIN_HOME = root;
  process.env.ROBIN_RUN_LEDGER_DIR = "run-ledger";
}

afterEach(() => {
  if (ORIGINAL_ROBIN_HOME === undefined) {
    delete process.env.ROBIN_HOME;
  } else {
    process.env.ROBIN_HOME = ORIGINAL_ROBIN_HOME;
  }

  if (ORIGINAL_RUN_LEDGER_DIR === undefined) {
    delete process.env.ROBIN_RUN_LEDGER_DIR;
  } else {
    process.env.ROBIN_RUN_LEDGER_DIR = ORIGINAL_RUN_LEDGER_DIR;
  }

  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("normalizeLookbackDays", () => {
  it("falls back to the default when the input is malformed", () => {
    expect(normalizeLookbackDays("abc")).toBe(7);
    expect(normalizeLookbackDays(null)).toBe(7);
  });

  it("clamps lookback days into the supported range", () => {
    expect(normalizeLookbackDays("0")).toBe(1);
    expect(normalizeLookbackDays(String(MAX_HISTORY_LOOKBACK_DAYS + 100))).toBe(MAX_HISTORY_LOOKBACK_DAYS);
  });
});

describe("getAllRunHistory", () => {
  it("returns only finished runs inside the requested lookback window", () => {
    const now = Date.now();

    writeLedger([
      {
        event: "run_finished",
        run_id: "recent-run",
        service: "chores",
        command: "bin/chores",
        started_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        finished_at: new Date(now - 2 * 24 * 60 * 60 * 1000 + 10_000).toISOString(),
        duration_ms: 10_000,
        result: "ok",
        log_path: "/tmp/recent.log",
        metadata: {},
      },
      {
        event: "run_finished",
        run_id: "older-run",
        service: "auto-coder",
        command: "bin/auto-coder",
        started_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        finished_at: new Date(now - 10 * 24 * 60 * 60 * 1000 + 20_000).toISOString(),
        duration_ms: 20_000,
        result: "ok",
        log_path: "/tmp/older.log",
        metadata: {},
      },
      {
        event: "run_started",
        run_id: "ignored-started-event",
        service: "chores",
        command: "bin/chores",
        started_at: new Date(now - 1_000).toISOString(),
        finished_at: null,
        duration_ms: null,
        result: null,
        log_path: "/tmp/ignored.log",
        metadata: {},
      },
    ]);

    const records = getAllRunHistory(10, 7);

    expect(records).toHaveLength(1);
    expect(records[0]?.run_id).toBe("recent-run");
  });

  it("keeps the newest records first after filtering", () => {
    const now = Date.now();

    writeLedger([
      {
        event: "run_finished",
        run_id: "older",
        service: "chores",
        command: "bin/chores",
        started_at: new Date(now - 3_000).toISOString(),
        finished_at: new Date(now - 2_500).toISOString(),
        duration_ms: 500,
        result: "ok",
        log_path: "/tmp/older.log",
        metadata: {},
      },
      {
        event: "run_finished",
        run_id: "newer",
        service: "chores",
        command: "bin/chores",
        started_at: new Date(now - 1_000).toISOString(),
        finished_at: new Date(now - 500).toISOString(),
        duration_ms: 500,
        result: "ok",
        log_path: "/tmp/newer.log",
        metadata: {},
      },
    ]);

    const records = getAllRunHistory(10, 7);

    expect(records.map((record) => record.run_id)).toEqual(["newer", "older"]);
  });
});

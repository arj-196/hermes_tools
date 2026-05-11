import fs from "node:fs";
import path from "node:path";

export type RunRecord = {
  event: string;
  run_id: string;
  service: string;
  command: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  result: string | null;
  exit_code: number | null;
  failure_code: string | null;
  message: string | null;
  log_path: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type LogTailResult = {
  tail: string;
  isTruncated: boolean;
};

const DEFAULT_ROBIN_HOME = ".robin";
const DEFAULT_RUN_LEDGER_DIR = "run-ledger";
const DEFAULT_LOG_RUNS_DIR = "logs";
const RUN_LEDGER_FILENAME = "run-ledger.jsonl";
export const DEFAULT_HISTORY_LOOKBACK_DAYS = 7;
export const MIN_HISTORY_LOOKBACK_DAYS = 1;
export const MAX_HISTORY_LOOKBACK_DAYS = 90;

function repoRoot(): string {
  return path.resolve(process.cwd(), "../../../../");
}

function resolveRobinHome(root: string): string {
  const configured = (process.env.ROBIN_HOME ?? DEFAULT_ROBIN_HOME).trim() || DEFAULT_ROBIN_HOME;
  return path.resolve(root, configured);
}

function resolvePath(root: string, robinHome: string, value: string): string {
  const configured = value.trim();
  if (!configured) {
    return robinHome;
  }
  return path.isAbsolute(configured) ? configured : path.resolve(robinHome, configured);
}

export function ledgerPath(): string {
  const root = repoRoot();
  const robinHome = resolveRobinHome(root);
  const ledgerDir = resolvePath(root, robinHome, process.env.ROBIN_RUN_LEDGER_DIR ?? DEFAULT_RUN_LEDGER_DIR);
  return path.resolve(ledgerDir, RUN_LEDGER_FILENAME);
}

function normalizeMetadata(input: unknown): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof key !== "string") {
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value as string | number | boolean | null;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

function parseRecord(line: string): RunRecord | null {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    return {
      event: String(payload.event ?? ""),
      run_id: String(payload.run_id ?? ""),
      service: String(payload.service ?? ""),
      command: String(payload.command ?? ""),
      started_at: String(payload.started_at ?? ""),
      finished_at: payload.finished_at ? String(payload.finished_at) : null,
      duration_ms: typeof payload.duration_ms === "number" ? payload.duration_ms : null,
      result: payload.result ? String(payload.result) : null,
      exit_code: typeof payload.exit_code === "number" ? payload.exit_code : null,
      failure_code: payload.failure_code ? String(payload.failure_code) : null,
      message: payload.message ? String(payload.message) : null,
      log_path: String(payload.log_path ?? ""),
      metadata: normalizeMetadata(payload.metadata),
    };
  } catch {
    return null;
  }
}

function recordTimestamp(record: RunRecord): number | null {
  const primary = record.finished_at || record.started_at;
  const value = Date.parse(primary);
  return Number.isFinite(value) ? value : null;
}

export function normalizeLookbackDays(value: string | null | undefined): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HISTORY_LOOKBACK_DAYS;
  }
  return Math.min(MAX_HISTORY_LOOKBACK_DAYS, Math.max(MIN_HISTORY_LOOKBACK_DAYS, parsed));
}

export function getAllRunHistory(limit: number, lookbackDays = DEFAULT_HISTORY_LOOKBACK_DAYS): RunRecord[] {
  const file = ledgerPath();
  if (!fs.existsSync(file)) {
    return [];
  }

  const safeLookbackDays = Math.min(MAX_HISTORY_LOOKBACK_DAYS, Math.max(MIN_HISTORY_LOOKBACK_DAYS, lookbackDays));
  const cutoff = Date.now() - safeLookbackDays * 24 * 60 * 60 * 1000;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  const records = lines
    .map(parseRecord)
    .filter((record): record is RunRecord => record !== null && record.event === "run_finished")
    .filter((record) => {
      const timestamp = recordTimestamp(record);
      return timestamp !== null && timestamp >= cutoff;
    });

  records.sort((a, b) => {
    const left = a.finished_at || a.started_at;
    const right = b.finished_at || b.started_at;
    return right.localeCompare(left);
  });

  return records.slice(0, Math.max(0, limit));
}

export function readLogTailFast(logPath: string, maxChars = 12000): LogTailResult {
  if (!fs.existsSync(logPath)) {
    throw new Error(`missing:${logPath}`);
  }
  const content = fs.readFileSync(logPath, "utf8");
  if (content.length <= maxChars) {
    return {
      tail: content,
      isTruncated: false,
    };
  }
  return {
    tail: `...[truncated]\n${content.slice(-maxChars)}`,
    isTruncated: true,
  };
}

export function readFullLog(logPath: string): string {
  if (!fs.existsSync(logPath)) {
    throw new Error(`missing:${logPath}`);
  }
  return fs.readFileSync(logPath, "utf8");
}

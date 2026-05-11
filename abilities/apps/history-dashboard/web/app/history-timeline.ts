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

export type TimelineDatum = {
  runId: string;
  service: string;
  result: string | null;
  timestamp: number;
  startedAt: string;
  startedAtLabel: string;
  durationMs: number;
  color: string;
};

export type TimelineRange = {
  startMs: number;
  endMs: number;
};

export const DEFAULT_HISTORY_LOOKBACK_DAYS = 7;
export const MIN_HISTORY_LOOKBACK_DAYS = 1;
export const MAX_HISTORY_LOOKBACK_DAYS = 90;

const SERVICE_COLORS: Record<string, string> = {
  chores: "#d97706",
  "auto-coder": "#175cd3",
};

const FALLBACK_SERVICE_COLOR = "#64748b";

export function clampLookbackDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_HISTORY_LOOKBACK_DAYS;
  }

  return Math.min(MAX_HISTORY_LOOKBACK_DAYS, Math.max(MIN_HISTORY_LOOKBACK_DAYS, Math.trunc(value)));
}

export function normalizeLookbackInput(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return clampLookbackDays(parsed);
}

export function formatTimelineTick(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(date);
}

export function getServiceColor(service: string): string {
  return SERVICE_COLORS[service] ?? FALLBACK_SERVICE_COLOR;
}

function startedAtTimestamp(record: RunRecord): number | null {
  const value = Date.parse(record.started_at);
  return Number.isFinite(value) ? value : null;
}

export function buildTimelineData(records: RunRecord[]): TimelineDatum[] {
  return records
    .map((record) => {
      const timestamp = startedAtTimestamp(record);
      if (timestamp === null) {
        return null;
      }

      return {
        runId: record.run_id,
        service: record.service,
        result: record.result,
        timestamp,
        startedAt: record.started_at,
        startedAtLabel: formatTimelineTick(record.started_at),
        durationMs: Math.max(record.duration_ms ?? 0, 0),
        color: getServiceColor(record.service),
      };
    })
    .filter((datum): datum is TimelineDatum => datum !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function deriveTimelineRangeFromIndexes(
  data: TimelineDatum[],
  startIndex: number,
  endIndex: number,
): TimelineRange | null {
  if (!data.length) {
    return null;
  }

  const safeStartIndex = Math.max(0, Math.min(startIndex, data.length - 1));
  const safeEndIndex = Math.max(0, Math.min(endIndex, data.length - 1));
  const left = data[Math.min(safeStartIndex, safeEndIndex)];
  const right = data[Math.max(safeStartIndex, safeEndIndex)];

  if (!left || !right) {
    return null;
  }

  return {
    startMs: left.timestamp,
    endMs: right.timestamp,
  };
}

export function isFullTimelineRange(
  data: TimelineDatum[],
  startIndex: number,
  endIndex: number,
): boolean {
  if (data.length <= 1) {
    return true;
  }

  return startIndex <= 0 && endIndex >= data.length - 1;
}

export function filterRecordsByTimelineRange(records: RunRecord[], range: TimelineRange | null): RunRecord[] {
  if (!range) {
    return records;
  }

  return records.filter((record) => {
    const timestamp = startedAtTimestamp(record);
    if (timestamp === null) {
      return false;
    }
    return timestamp >= range.startMs && timestamp <= range.endMs;
  });
}

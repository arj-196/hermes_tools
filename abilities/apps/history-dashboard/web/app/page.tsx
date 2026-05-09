"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";

type RunRecord = {
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

type LogTailResponse = {
  tail?: string;
  isTruncated?: boolean;
  error?: string;
};

type DetailItem = {
  label: string;
  value: string;
};

const ALL_FILTER_VALUE = "__all__";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not finished";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "Running";
  }

  if (durationMs < 1_000) {
    return `${durationMs} ms`;
  }

  const totalSeconds = durationMs / 1_000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds >= 10 ? 0 : 1)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function buildSummaryItems(record: RunRecord): string[] {
  const items = [
    `Run ID ${record.run_id}`,
    `Duration ${formatDuration(record.duration_ms)}`,
  ];

  if (record.failure_code) {
    items.push(`Failure ${record.failure_code}`);
  }

  if (record.exit_code !== null) {
    items.push(`Exit ${record.exit_code}`);
  }

  for (const [key, value] of Object.entries(record.metadata)) {
    items.push(`${formatLabel(key)} ${formatValue(value)}`);
  }

  return items;
}

function buildDetailItems(record: RunRecord): DetailItem[] {
  return [
    { label: "Service", value: record.service },
    { label: "Run ID", value: record.run_id },
    { label: "Result", value: record.result || "Pending" },
    { label: "Started", value: formatDateTime(record.started_at) },
    { label: "Finished", value: formatDateTime(record.finished_at) },
    { label: "Duration", value: formatDuration(record.duration_ms) },
    { label: "Exit code", value: formatValue(record.exit_code) },
    { label: "Failure code", value: formatValue(record.failure_code) },
    { label: "Command", value: record.command },
    { label: "Log path", value: record.log_path },
  ];
}

export default function Home(): ReactElement {
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedService, setSelectedService] = useState(ALL_FILTER_VALUE);
  const [selectedResult, setSelectedResult] = useState(ALL_FILTER_VALUE);
  const [runQuery, setRunQuery] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  const [logText, setLogText] = useState("");
  const [isTruncated, setIsTruncated] = useState(false);
  const [isFullLogLoaded, setIsFullLogLoaded] = useState(false);
  const [isLoadingFullLog, setIsLoadingFullLog] = useState(false);
  const [logLoadError, setLogLoadError] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/history")
      .then((response) => response.json())
      .then((payload: { records: RunRecord[] }) => {
        setRecords(payload.records || []);
      })
      .catch(() => setError("Failed to load run history."));
  }, []);

  const services = useMemo(
    () => [...new Set(records.map((record) => record.service).filter(Boolean))].sort(),
    [records],
  );
  const results = useMemo(
    () => [...new Set(records.map((record) => record.result || "").filter(Boolean))].sort(),
    [records],
  );

  const filtered = useMemo(() => {
    const query = runQuery.trim().toLowerCase();
    return records.filter((record) => {
      if (selectedService !== ALL_FILTER_VALUE && record.service !== selectedService) {
        return false;
      }
      if (selectedResult !== ALL_FILTER_VALUE && (record.result || "") !== selectedResult) {
        return false;
      }
      if (query && !record.run_id.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [records, runQuery, selectedResult, selectedService]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    if (!filtered.some((record) => record.run_id === selectedRunId)) {
      setSelectedRunId("");
    }
  }, [filtered, selectedRunId]);

  const selected = filtered.find((record) => record.run_id === selectedRunId) || null;
  const selectedMetadata = selected ? Object.entries(selected.metadata) : [];
  const selectedSummaryItems = selected ? buildDetailItems(selected) : [];

  useEffect(() => {
    if (!selected) {
      setLogText("");
      setIsTruncated(false);
      setIsFullLogLoaded(false);
      setIsLoadingFullLog(false);
      setLogLoadError(null);
      return;
    }

    setLogText("");
    setIsTruncated(false);
    setIsFullLogLoaded(false);
    setIsLoadingFullLog(false);
    setLogLoadError(null);

    void fetch(`/api/log-tail?logPath=${encodeURIComponent(selected.log_path)}`)
      .then((response) => response.json())
      .then((payload: LogTailResponse) => {
        if (payload.error) {
          setLogLoadError(payload.error);
          setLogText("");
          setIsTruncated(false);
          return;
        }
        setLogText(payload.tail || "");
        setIsTruncated(Boolean(payload.isTruncated));
      })
      .catch(() => {
        setLogLoadError("Failed to load log tail.");
        setLogText("");
        setIsTruncated(false);
      });
  }, [selected]);

  const handleLoadFullLog = (): void => {
    if (!selected || !isTruncated || isLoadingFullLog || isFullLogLoaded) {
      return;
    }

    setIsLoadingFullLog(true);
    setLogLoadError(null);

    void fetch(`/api/log-full?logPath=${encodeURIComponent(selected.log_path)}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || "Failed to load full log.");
        }
        return response.text();
      })
      .then((text) => {
        setLogText(text);
        setIsFullLogLoaded(true);
        setIsTruncated(false);
      })
      .catch((err: unknown) => {
        setLogLoadError(err instanceof Error ? err.message : "Failed to load full log.");
      })
      .finally(() => {
        setIsLoadingFullLog(false);
      });
  };

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-title-block">
          <p className="eyebrow">Robin App</p>
          <h1>History Dashboard</h1>
          <p className="header-subtitle">
            {filtered.length} visible of {records.length} total run records
          </p>
        </div>

        <section className="filter-bar" aria-label="Run history filters">
          <label className="filter-field">
            <span>Service</span>
            <select value={selectedService} onChange={(event) => setSelectedService(event.target.value)}>
              <option value={ALL_FILTER_VALUE}>All services</option>
              {services.map((service) => (
                <option key={service} value={service}>
                  {service}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Result</span>
            <select value={selectedResult} onChange={(event) => setSelectedResult(event.target.value)}>
              <option value={ALL_FILTER_VALUE}>All results</option>
              {results.map((result) => (
                <option key={result} value={result}>
                  {result}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field filter-search">
            <span>Run ID</span>
            <input
              value={runQuery}
              onChange={(event) => setRunQuery(event.target.value)}
              placeholder="Search run ID"
            />
          </label>
        </section>
      </header>

      {error ? <p className="banner-error">{error}</p> : null}

      <section className="workspace">
        <aside className="run-list-pane">
          <div className="pane-header">
            <h2>Run Records</h2>
            <p>{filtered.length} shown</p>
          </div>

          <div className="run-list-scroll">
            {filtered.length ? (
              filtered.map((record) => {
                const isSelected = record.run_id === selectedRunId;
                return (
                  <button
                    key={record.run_id}
                    type="button"
                    className={`run-card${isSelected ? " selected" : ""}`}
                    onClick={() => setSelectedRunId(record.run_id)}
                  >
                    <div className="run-card-topline">
                      <span className="service-pill">{record.service}</span>
                      <span className={`result-pill result-${record.result || "pending"}`}>
                        {record.result || "pending"}
                      </span>
                    </div>

                    <div className="run-card-primary">
                      <span>{formatDateTime(record.started_at)}</span>
                      <span>{formatDuration(record.duration_ms)}</span>
                    </div>

                    <div className="run-card-summary">
                      {buildSummaryItems(record).map((item) => (
                        <span key={item} className="summary-chip">
                          {item}
                        </span>
                      ))}
                    </div>

                    {record.message ? <p className="run-card-message">{record.message}</p> : null}
                  </button>
                );
              })
            ) : (
              <div className="list-empty-state">
                <h3>No matching runs</h3>
                <p>Adjust the filters to see more run records.</p>
              </div>
            )}
          </div>
        </aside>

        <section className="detail-pane">
          {!selected ? (
            <div className="detail-placeholder">
              <div className="placeholder-orb" />
              <h2>Select a run record</h2>
              <p>Choose a run from the left pane to inspect its summary, metadata, and log preview.</p>
            </div>
          ) : (
            <div className="detail-scroll">
              <section className="detail-section">
                <div className="section-heading">
                  <h2>Run Summary</h2>
                  <span className={`result-pill result-${selected.result || "pending"}`}>
                    {selected.result || "pending"}
                  </span>
                </div>
                <div className="detail-grid">
                  {selectedSummaryItems.map((item) => (
                    <div key={item.label} className="detail-card">
                      <p>{item.label}</p>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-section">
                <div className="section-heading">
                  <h2>Service-Specific Details</h2>
                </div>
                {selectedMetadata.length ? (
                  <div className="detail-grid">
                    {selectedMetadata.map(([key, value]) => (
                      <div key={key} className="detail-card">
                        <p>{formatLabel(key)}</p>
                        <strong>{formatValue(value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-detail-card">
                    <p>No service metadata was recorded for this run.</p>
                  </div>
                )}
              </section>

              <section className="detail-section">
                <div className="section-heading">
                  <h2>Derived Log Insights</h2>
                </div>
                <div className="empty-detail-card">
                  <p>Derived insights are not enabled in this pass. This view is currently ledger-backed.</p>
                </div>
              </section>

              <section className="detail-section">
                <div className="log-header-row">
                  <h2>{isFullLogLoaded ? "Run Log (Full)" : "Run Log Preview"}</h2>
                  {isTruncated ? (
                    <button
                      type="button"
                      className="load-full-log-button"
                      onClick={handleLoadFullLog}
                      disabled={isLoadingFullLog}
                    >
                      {isLoadingFullLog ? "Loading full log..." : "Load full log"}
                    </button>
                  ) : null}
                </div>

                {logLoadError ? <p className="inline-error">{logLoadError}</p> : null}
                <pre className="log-output">{logText || "No log preview available."}</pre>
              </section>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiffReport } from "../../src/diff.js";
import type { TraceEvent } from "../../src/types.js";

function ForkTraceLogo() {
  return (
    <div className="brand-mark" aria-label="ForkTrace">
      <svg viewBox="0 0 48 48" role="img" aria-hidden="true">
        <path className="logo-frame" d="M8 7.5h32v33H8z" />
        <path className="logo-trace" d="M15 15h8v18h10" />
        <path className="logo-fork" d="M23 24h6l5-5" />
        <circle className="logo-node" cx="15" cy="15" r="2" />
        <circle className="logo-node" cx="34" cy="19" r="2" />
        <circle className="logo-node" cx="33" cy="33" r="2" />
      </svg>
    </div>
  );
}

interface RunSummary {
  file_name: string;
  run_id: string;
  parent_run_id: string | null;
  status: string;
  event_count: number;
}

interface ForkResponse {
  original_file_name: string;
  fork_file_name: string;
  original_events: TraceEvent[];
  fork_events: TraceEvent[];
  report: DiffReport;
  text_summary: string;
}

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null);
  const [forkSource, setForkSource] = useState<TraceEvent | null>(null);
  const [editText, setEditText] = useState("");
  const [forkResult, setForkResult] = useState<ForkResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    const result = await api<{ runs: RunSummary[] }>("/api/runs");
    setRuns(result.runs);
  }, []);

  useEffect(() => {
    void refreshRuns().catch(showError);
  }, [refreshRuns]);

  const roots = useMemo(
    () => runs.filter(({ parent_run_id }) => parent_run_id === null),
    [runs],
  );

  async function selectRun(file: string) {
    setError(null);
    const result = await api<{ events: TraceEvent[] }>(
      `/api/runs/${encodeURIComponent(file)}`,
    );
    setSelectedFile(file);
    setEvents(result.events);
    setSelectedEvent(result.events[0] ?? null);
    setForkResult(null);
  }

  async function runDemo() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ file_name: string; events: TraceEvent[] }>(
        "/api/demo",
        {
          method: "POST",
        },
      );
      await refreshRuns();
      setSelectedFile(result.file_name);
      setEvents(result.events);
      setSelectedEvent(
        result.events.find(({ event_type }) => event_type === "error") ?? null,
      );
      setForkResult(null);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  function openFork(event: TraceEvent) {
    setForkSource(event);
    setEditText(
      JSON.stringify(
        event.event_type === "tool_result" ? event.output : event.input,
        null,
        2,
      ),
    );
  }

  async function forkAndReplay() {
    if (forkSource === null || selectedFile === null) return;
    setBusy(true);
    setError(null);
    try {
      const value: unknown = JSON.parse(editText);
      const edit =
        forkSource.event_type === "tool_result"
          ? { type: "tool_result", output: value }
          : { type: "tool_call_argument", arguments: value };
      const result = await api<ForkResponse>("/api/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file_name: selectedFile,
          event_index: forkSource.event_index,
          edit,
        }),
      });
      setForkResult(result);
      setForkSource(null);
      await refreshRuns();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  function showError(caught: unknown) {
    setError(caught instanceof Error ? caught.message : "Unexpected error");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <ForkTraceLogo />
          <div>
            <h1>ForkTrace</h1>
            <p className="eyebrow">Agent execution debugger</p>
          </div>
        </div>
        <div className="header-context" aria-hidden="true">
          <span className="signal-dot" />
          <span>Local trace environment</span>
        </div>
        <button
          className="demo-button"
          disabled={busy}
          onClick={() => void runDemo()}
        >
          <span className="button-icon">▶</span>
          {busy ? "Running…" : "Run demo scenario"}
        </button>
      </header>

      <main className="workspace">
        <aside className="run-panel">
          <div className="rail-brandline">
            <span>Trace explorer</span>
            <span className="rail-version">v0.1</span>
          </div>
          <div className="panel-heading">
            <span>Runs</span>
            <span className="count">{runs.length}</span>
          </div>
          {roots.length === 0 ? (
            <p className="empty-copy">
              Run the demo to record its failing execution.
            </p>
          ) : (
            roots.map((run) => (
              <div className="run-family" key={run.run_id}>
                <RunButton
                  run={run}
                  selected={selectedFile === run.file_name}
                  onSelect={selectRun}
                />
                {runs
                  .filter(({ parent_run_id }) => parent_run_id === run.run_id)
                  .map((fork) => (
                    <div className="nested-run" key={fork.run_id}>
                      <span className="branch-line">↳</span>
                      <RunButton
                        run={fork}
                        selected={selectedFile === fork.file_name}
                        onSelect={selectRun}
                      />
                    </div>
                  ))}
              </div>
            ))
          )}
        </aside>

        <section className="main-stage">
          {error !== null && <div className="error-banner">{error}</div>}
          {forkResult !== null && <DiffBanner result={forkResult} />}
          {events.length === 0 ? (
            <EmptyState onRun={() => void runDemo()} />
          ) : (
            <div
              className={
                forkResult === null
                  ? "timeline-grid"
                  : "timeline-grid comparison"
              }
            >
              <Timeline
                title="Original run"
                events={forkResult?.original_events ?? events}
                selected={selectedEvent}
                onSelect={setSelectedEvent}
                onFork={openFork}
                changedArguments={forkResult?.report.edit ?? null}
                trace="original"
              />
              {forkResult !== null && (
                <Timeline
                  title="Forked run"
                  events={forkResult.fork_events}
                  selected={selectedEvent}
                  onSelect={setSelectedEvent}
                  onFork={openFork}
                  changedArguments={forkResult.report.edit}
                  trace="fork"
                />
              )}
              <EventDetail event={selectedEvent} />
            </div>
          )}
        </section>
      </main>

      {forkSource !== null && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setForkSource(null);
          }}
        >
          <section
            className="fork-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <p className="eyebrow">Fork at event {forkSource.event_index}</p>
            <h2>Edit {forkSource.tool_name}</h2>
            <p className="modal-copy">
              The original remains immutable. Replay begins from this edited
              observable event.
            </p>
            <textarea
              value={editText}
              onChange={(event) => {
                setEditText(event.target.value);
              }}
              spellCheck={false}
            />
            <div className="modal-actions">
              <button
                className="quiet-button"
                onClick={() => {
                  setForkSource(null);
                }}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void forkAndReplay()}
              >
                {busy ? "Replaying…" : "Fork & Replay"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function RunButton({
  run,
  selected,
  onSelect,
}: {
  run: RunSummary;
  selected: boolean;
  onSelect: (file: string) => Promise<void>;
}) {
  return (
    <button
      className={`run-button ${selected ? "selected" : ""}`}
      onClick={() => {
        void onSelect(run.file_name);
      }}
    >
      <span className={`status-dot ${statusClass(run.status)}`} />
      <span className="run-copy">
        <strong>{run.parent_run_id === null ? "Original" : "Fork"}</strong>
        <small>{run.event_count} events</small>
      </span>
      <span className="run-status">{displayStatus(run.status)}</span>
    </button>
  );
}

function Timeline({
  title,
  events,
  selected,
  onSelect,
  onFork,
  changedArguments,
  trace,
}: {
  title: string;
  events: TraceEvent[];
  selected: TraceEvent | null;
  onSelect: (event: TraceEvent) => void;
  onFork: (event: TraceEvent) => void;
  changedArguments: DiffReport["edit"] | null;
  trace: "original" | "fork";
}) {
  return (
    <section className="timeline-panel">
      <div className="panel-heading">
        <span>{title}</span>
        <span className="count">{events.length}</span>
      </div>
      <div className="timeline">
        {events.map((event) => {
          const canFork =
            event.event_type === "tool_call" ||
            event.event_type === "tool_result";
          return (
            <article
              className={`event-card ${statusClass(event.status)} ${selected?.event_id === event.event_id ? "active" : ""}`}
              key={event.event_id}
              onClick={() => {
                onSelect(event);
              }}
            >
              <div className="event-rail">
                <span className="event-index">
                  {String(event.event_index).padStart(2, "0")}
                </span>
                <span className="event-icon">
                  {eventIcon(event.event_type)}
                </span>
              </div>
              <div className="event-body">
                {event.event_type === "diverged" && (
                  <div className="diverged-label">
                    DIVERGED — live execution from here
                  </div>
                )}
                <div className="event-title-row">
                  <strong>{eventLabel(event)}</strong>
                  <span>
                    {event.latency_ms === null
                      ? "—"
                      : `${String(event.latency_ms)} ms`}
                  </span>
                </div>
                <p>{event.tool_name ?? eventSummary(event)}</p>
                {event.event_type === "tool_call" && (
                  <ToolArguments
                    value={event.input}
                    comparison={
                      changedArguments?.event_index === event.event_index
                        ? trace === "original"
                          ? changedArguments.after
                          : changedArguments.before
                        : null
                    }
                  />
                )}
                {canFork && (
                  <button
                    className="fork-button"
                    onClick={(click) => {
                      click.stopPropagation();
                      onFork(event);
                    }}
                  >
                    Fork here
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EventDetail({ event }: { event: TraceEvent | null }) {
  return (
    <aside className="detail-panel">
      <div className="panel-heading">
        <span>Event detail</span>
        {event !== null && <span className="count">#{event.event_index}</span>}
      </div>
      {event === null ? (
        <p className="empty-copy">
          Select an event to inspect recorded evidence.
        </p>
      ) : (
        <div className="detail-content">
          <Detail label="Input" value={event.input} />
          <Detail label="Output" value={event.output} />
          <Detail label="Context snapshot" value={event.context_snapshot} />
          <Detail label="Token usage" value={event.token_usage} />
        </div>
      )}
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="detail-block">
      <h3>{label}</h3>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function DiffBanner({ result }: { result: ForkResponse }) {
  const { original, fork } = result.report;
  const finding = result.report.findings[0];
  const evidence = finding?.evidence
    .map(
      ({ trace, event_indexes }) =>
        `${trace} event${event_indexes.length === 1 ? "" : "s"} ${event_indexes.join(", ")}`,
    )
    .join(" · ");
  return (
    <section className="diff-banner">
      <div>
        <p className="eyebrow">Replay complete</p>
        <h2>One edit. A different outcome.</h2>
      </div>
      <div className="diff-lines">
        <strong>
          {displayStatus(original.status)} → {displayStatus(fork.status)}
        </strong>
        <span>
          Total latency {formatLatency(original.total_latency_ms)} →{" "}
          {formatLatency(fork.total_latency_ms)}
        </span>
        <span>
          Token usage {original.token_usage.total_tokens} →{" "}
          {fork.token_usage.total_tokens}
        </span>
        <small>
          Tool calls: {original.tool_calls} → {fork.tool_calls}
        </small>
      </div>
      <div className="diff-meta">
        <strong>First divergence</strong>
        <span>
          Event {result.report.first_divergence_event_index} ·{" "}
          {result.report.diverged_tool_name}
        </span>
      </div>
      {finding !== undefined && (
        <div className="measured-finding">
          <span>Measured finding</span>
          <strong>{finding.message}</strong>
          <small>Evidence: {evidence}</small>
        </div>
      )}
    </section>
  );
}

function ToolArguments({
  value,
  comparison,
}: {
  value: TraceEvent["input"];
  comparison: unknown;
}) {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    return null;
  const other =
    comparison !== null &&
    !Array.isArray(comparison) &&
    typeof comparison === "object"
      ? (comparison as Record<string, unknown>)
      : null;
  return (
    <div className="tool-arguments">
      {Object.entries(value).map(([key, argument]) => {
        if (key === "currency" && "amount" in value) return null;
        const changed =
          other !== null &&
          JSON.stringify(argument) !== JSON.stringify(other[key]);
        return (
          <span className={changed ? "changed-argument" : ""} key={key}>
            {key}={formatToolArgument(key, argument, value)}
          </span>
        );
      })}
    </div>
  );
}

function formatToolArgument(
  key: string,
  value: unknown,
  input: Record<string, unknown>,
): string {
  if (
    key === "amount" &&
    typeof value === "number" &&
    input.currency === "USD"
  ) {
    return `$${String(value)} USD`;
  }
  return formatArgument(value);
}

function formatArgument(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatLatency(milliseconds: number): string {
  return `${milliseconds.toFixed(1)} ms`;
}

function EmptyState({ onRun }: { onRun: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-orbit">↯</div>
      <p className="eyebrow">Ready to trace</p>
      <h2>See exactly where an agent run went wrong.</h2>
      <p>
        Record the deterministic customer-refund failure, inspect each
        observable event, then fork the bad tool call.
      </p>
      <button className="primary-button" onClick={onRun}>
        Run demo scenario
      </button>
    </section>
  );
}

function eventLabel(event: TraceEvent): string {
  const labels: Record<TraceEvent["event_type"], string> = {
    run_started: "Run started",
    user_input: "User input",
    model_output: "Model decision",
    tool_call: "Tool call",
    tool_result: "Tool result",
    context_snapshot: "State snapshot",
    error: "Error",
    final_output: "Final output",
    run_completed: "Run completed",
    diverged: "Diverged",
  };
  return labels[event.event_type];
}

function eventIcon(type: TraceEvent["event_type"]): string {
  return {
    run_started: "▶",
    user_input: "↳",
    model_output: "◇",
    tool_call: "⚙",
    tool_result: "✓",
    context_snapshot: "▣",
    error: "!",
    final_output: "◆",
    run_completed: "■",
    diverged: "↯",
  }[type];
}

function eventSummary(event: TraceEvent): string {
  if (event.event_type === "user_input" && typeof event.input === "string")
    return event.input;
  if (event.event_type === "error") return "Recorded execution failure";
  return event.status;
}

function statusClass(status: string): string {
  if (status === "failed" || status === "error") return "failed";
  if (status === "diverged") return "diverged";
  return "ok";
}

function displayStatus(status: string): string {
  return statusClass(status) === "failed"
    ? "Failed"
    : statusClass(status) === "diverged"
      ? "Diverged"
      : "Passed";
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      value.error ?? `Request failed: ${String(response.status)}`,
    );
  return value;
}

# 0001. Docker execution engine for abilities

## Status

Accepted

## Context

Robin abilities were executed directly on the host through local tools such as
`uv`, `npm`, and `codex`. That made Ubuntu server execution sensitive to
differences from the macOS development environment.

Services also need access to shared runtime state under `ROBIN_HOME`, and the
auto-coder service needs access to target repositories under
`AUTO_CODER_APPS_ROOT`.

## Decision

Robin app and service wrappers use Docker as the default execution engine.
Each wrapper is autonomous: it loads environment, resolves host paths, builds
its image when missing, and runs its own container without delegating through a
shared Docker dispatcher. Each ability has its own image:

- `robin-auto-coder`
- `robin-chores`
- `robin-history-dashboard`

Host paths from `.env` are resolved by the owning wrapper and mounted to
canonical container paths:

- `ROBIN_HOME=/robin-home`
- `AUTO_CODER_APPS_ROOT=/apps`

Ubuntu cron remains the scheduler, but cron commands call the Dockerized
ability wrappers. Service containers do not mount the Docker socket. Codex CLI
state is mounted from host `~/.codex`, and service images pin
`@openai/codex@0.128.0`.

## Consequences

Ability execution no longer depends on host `uv`, host `npm`, or host `codex`.
The per-ability Docker wrappers become the deployment contract for apps and
cron-invoked services.

The host still owns scheduling, Docker installation, `.env`, runtime state, and
target repository directories.

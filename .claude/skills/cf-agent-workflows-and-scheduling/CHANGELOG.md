# Changelog

All notable changes to the **cf-agent-workflows-and-scheduling** skill are
documented here.

## [1.0.0] - 2026-04-30

### Added

- Initial SKILL.md covering `this.schedule()`, DO `alarm()`, Workflows
  from agents, Queues, durable execution (`runFiber` / `stash` /
  `onFiberRecovered` / `keepAliveWhile`), and the AbortSignal-doesn't-
  cross-DO-RPC gotcha.
- `references/scheduling-decision-tree.md` — schedule vs alarm vs
  Workflow vs Queue, with worked examples.
- `references/schedule-api.md` — full `this.schedule()` /
  `scheduleEvery` / `getSchedules` / `cancelSchedule` reference plus
  cron-syntax cheat sheet.
- `references/workflow-from-agent.md` — patterns for invoking,
  awaiting, and bidirectionally messaging a Workflow from an Agent;
  includes the `migrateWorkflowBinding` rename gotcha.
- `references/durable-execution.md` — `runFiber` checkpoint pattern,
  `onFiberRecovered` recovery shape, `keepAliveWhile` for streamed
  outputs, sub-agent restrictions.
- `references/idempotency-rules.md` — the 8 Workflow idempotency rules
  with violation examples.
- `scripts/schedule-introspect.ts` — TypeScript CLI that connects to a
  deployed agent (via `AgentClient` or a debug `/__schedules` HTTP
  route) and pretty-prints every pending schedule with next fire time.

# Roadmap

## Current - auditable lineage

- [x] Persist honest fork-result evidence: measured scope or illustrative simulation, bounded changed paths, host/simulation checks.
- [x] Expose every active + terminal run through an activity center with full curated timeline.
- [x] Connect runs to tree versions; support failed-run retry + live Git or synthetic-preview copy handoff.
- [x] Stabilize graph focus as lineage grows; preserve usable desktop/mobile navigation.
- [x] Harden keyboard, focus, touch-target, live-status + time freshness behavior.
- [x] Validate server, client, production build + responsive visual states; document exact guarantees.
- [x] Bound retained public history by pre-reservation worst-case lifecycle admission; preserve full history below 4 MiB.
- [x] Isolate raw Git object reads from replace/graft/shallow overrides; preflight exact committed manifests without state writes.
- [x] Terminate same-group descendants on every captured-process settlement.

## Next - lifecycle durability

- Repository baseline import: preserve prior lineage while adding a newer committed `HEAD` + manifest root.
- Explicit run cancellation + graceful shutdown propagated through process groups and durable state.
- Versioned persisted-state schema, deep validation, migration + corrupt-state recovery.
- Single-writer filesystem lock; directory `fsync` after atomic replacement.
- Runner readiness probes for Codex executable/auth, Git capabilities + writable data root.

## Later - bounded scale

- Search/jump + root-to-selection highlighting for 25+ version trees.
- Paginated/archive projections; configurable run/log/version retention.
- Safe worktree/branch inspection + recoverable cleanup workflow.
- Adversarial subprocess tests: history mutation, detached-session escape + hostile Git filters/hooks.
- Automated browser regressions for standalone + in-progress host theme, pointer selection, activity/retry/copy/modal + responsive workflows.

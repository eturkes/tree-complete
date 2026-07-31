# Roadmap

## Current - auditable lineage

- [x] Persist honest fork-result evidence: measured scope or illustrative simulation, bounded changed paths, host/simulation checks.
- [x] Expose every active + terminal run through an activity center with full curated timeline.
- [x] Connect runs to tree versions; support failed-run retry + live Git or synthetic-preview copy handoff.
- [x] Stabilize graph focus as lineage grows; preserve usable desktop/mobile navigation.
- [x] Harden keyboard, focus, touch-target, live-status + time freshness behavior.
- [x] Validate server, client, production build + responsive visual states; document exact guarantees.

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
- Adversarial subprocess tests: timeout, history mutation, descendants + hostile Git environment.
- Automated browser regressions for activity/retry/copy/modal/responsive workflows.

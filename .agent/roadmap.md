# Roadmap

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

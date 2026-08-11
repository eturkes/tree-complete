# Tree Complete

Tree Complete turns architectural intent into an explorable program lineage. Ready and completed tree nodes are complete program versions; queued, working, and failed children are retained fork attempts. The decisions inside a realized version are live fork points. Pick a different alternative and a coding agent works toward a child version without disturbing its parent.

## Run it

Requirements: Node 20.19+ and pnpm. Live Codex mode also requires Git and an installed, authenticated `codex` executable on `PATH`.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4317`. Target-less preview mode is the default: it exercises validation, persistence, progress, lineage creation, and the result interface with explicitly illustrative Tree Complete demo data. It does not inspect a repository.

When preview receives `TREE_COMPLETE_TARGET_REPO`, startup read-only inspects the canonical Git root, branch, and exact committed `HEAD`. A valid committed `.tree-complete/project.json` supplies project identity and decisions. If that file is absent, the workspace visibly labels its decisions as generic illustrative fallback data; a present but invalid manifest still fails startup. Preview simulations do not mutate project files, the index, refs, or `HEAD`. State is isolated by canonical target and baseline commit, so moving `HEAD` creates a new preview lineage while an unchanged baseline reopens its prior lineage.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The production server listens at `http://127.0.0.1:4318` and serves the built client.

`pnpm build` removes only `dist/server`, recompiles it, smoke-imports the embedded exports, then emits the standalone client and in-progress integration:

- `dist/server/server/embedded.js` exports `createEmbeddedService({ targetRepo, dataDir, mode })`, `preflightProjectManifest(targetRepo: string): Promise<void>`, and the `TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES` contract;
- `dist/plugin/in-progress.plugin.json` describes the static `tree-complete` client and allowlists every emitted asset;
- `dist/plugin/plugin.html` uses only relative asset URLs, so the host can serve it from its own plugin route.

The embedded service exposes `workspace()`, `createFork({ baseVersionId, decisionId, alternativeId })`, and `close()`. It reuses the same validated Fastify routes, store, orchestrator, runner, and public redaction as the standalone server. `preflightProjectManifest()` canonicalizes the target and strictly parses its manifest from the raw committed `HEAD` without opening a workspace store; service startup independently repeats that authoritative inspection. The in-progress host confirms every `tree-complete.createFork` request before calling the service; the plugin client cannot bypass that host boundary. Preview remains the default mode. The embedded client applies the host theme mode, palette, and fonts; target-less standalone keeps Tree Complete’s light visual identity.

`close()` rejects new calls, drains in-flight API operations, waits for every orchestrated run, then closes Fastify. Shutdown intentionally does not interrupt a valid Codex run; it can therefore take until Codex exits or reaches its runner timeout (30 minutes by default). Every process settlement kills the detached managed process group, including descendants left after a successful leader exit. Once `close()` resolves, no process remains in that managed group.

## Create a fork

1. Select a decision row inside any version card.
2. Compare the alternatives and their expected impact.
3. Choose a different alternative, then select **Preview this fork** or **Generate this fork**.
4. Follow the current run in the activity tray. A fork attempt appears immediately as a child and becomes a completed program version only after the runner succeeds.
5. Open **Activity** for the complete run history, fork provenance, result evidence, and full curated timeline.

Refreshing the page preserves the target-less demo in `.tree-complete/workspace.preview.json`. Targeted previews use `.tree-complete/workspace.preview-<digest>.json`, with the digest bound to canonical repository identity, branch, and committed baseline.

Workspace and fork responses share a 4 MiB compact-JSON contract with the in-progress host. Before reserving a fork, Tree Complete projects the largest permitted terminal form of the candidate and every active run (at most two), including bounded logs, result evidence, summary/commit metadata, and the fork-response envelope. Accepted runs therefore cannot make the public response cross that limit later. History remains complete and unpruned below the boundary. A `429 workspace_history_limit_reached` response leaves persisted state byte-for-byte unchanged; keep that history for inspection and select a new empty `TREE_COMPLETE_DATA_DIR` to begin another lineage.

## Inspect a result

Select **Activity** in the header, **Open full activity** in the run tray, or the evidence icon on a generated version. Active runs sort first; completed and failed runs remain available behind them.

Every run records its exact base version, decision, old choice, new choice, and complete curated orchestration timeline. Successful runs additionally record:

- measured changed-file scope in Codex mode, or clearly labeled illustrative scope in preview mode;
- host-enforced Git integrity checks in Codex mode, or an explicit simulation check in preview mode;
- the result branch and commit for a completed Codex run, or synthetic branch/result IDs for a preview, with copy controls.

Failed runs retain their error and reserved branch/base commit context. **Retry** creates a new run from the same immutable request and keeps the failed attempt in history.

## Use a real Codex agent

First describe the target program’s forkable decisions in a tracked `.tree-complete/project.json`. The [manifest in this repository](.tree-complete/project.json) is a complete example. Its compact shape is:

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "my-program",
    "name": "My program",
    "description": "What this program does."
  },
  "decisions": [{
    "id": "storage",
    "title": "Storage boundary",
    "question": "Where should canonical state live?",
    "rationale": "This choice controls recovery and collaboration.",
    "chosenAlternativeId": "local-json",
    "alternatives": [{
      "id": "local-json",
      "label": "Local JSON",
      "description": "Keep state beside the process.",
      "impact": "Simple operation with one writer.",
      "signal": "recommended",
      "brief": {
        "objective": "Keep state local and inspectable.",
        "constraints": ["Preserve the public API."],
        "acceptance": ["Writes remain atomic."]
      }
    }, {
      "id": "sqlite",
      "label": "Embedded SQLite",
      "description": "Use a transactional embedded database.",
      "impact": "Richer queries with a binary dependency.",
      "signal": "balanced",
      "brief": {
        "objective": "Move canonical state into SQLite.",
        "constraints": ["Keep deployment single-process."],
        "acceptance": ["Existing state survives migration."]
      }
    }]
  }]
}
```

Every decision needs at least two alternatives. IDs are stable lowercase slugs; fields and lengths are strictly validated. The manifest accepts design intent only - no executable, path, model, or raw command fields.

Commit that file, then point Tree Complete at the trusted repository through server-owned environment configuration:

```sh
export TREE_COMPLETE_AGENT_MODE=codex
export TREE_COMPLETE_TARGET_REPO=/absolute/path/to/repository
pnpm dev
```

At startup, the service reads the manifest from the target’s exact committed `HEAD`; dirty manifest edits are ignored, as are local replacement refs, grafts, and shallow-boundary overrides. For each request Tree Complete creates a sanitized `tree-complete/...` branch from the selected version’s immutable full commit, records the selected choice in the dedicated fork worktree’s manifest, and feeds Codex the structured brief over stdin. The runner invokes the user’s canonical `codex --yolo exec` runtime from that worktree. It inherits the Tree Complete process environment, user configuration, configured GPT model and reasoning effort, and applicable instructions; `--yolo` disables approval and sandbox enforcement. Codex is asked to discover and run checks relevant to its edits. The host independently requires a non-empty implementation diff beyond the manifest, a whitespace-clean patch, the expected worktree/manifest identity, and a clean direct-child commit. Those host checks do not attest that the target project’s tests passed. Tree Complete’s own file and Git mutations target the dedicated worktree and branch. Failed and successful worktrees remain available for local inspection and appear in `git worktree list` from the target repository.

A persisted workspace stays pinned to the baseline commit from which it was created. Moving the target repository’s `HEAD` does not silently replace that lineage. Point `TREE_COMPLETE_DATA_DIR` at a new empty directory when you intentionally want a separate workspace rooted at the newer commit.

`--yolo` gives Codex unsandboxed, non-interactive authority as the same operating-system user running Tree Complete. The agent can modify the source checkout or anything else that user can reach, not only the generated worktree, and can deliberately escape the managed process group by daemonizing into another session. Live mode is therefore limited to trusted repositories and trusted instructions. Repository instructions and Git filters are code-execution surfaces; use a separate container or operating-system identity for untrusted input and containment guarantees.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TREE_COMPLETE_AGENT_MODE` | `preview` | `preview` or `codex` |
| `TREE_COMPLETE_TARGET_REPO` | - | Optional read-only preview target; trusted repository with a committed manifest required for `codex` |
| `TREE_COMPLETE_DATA_DIR` | `.tree-complete` | State and generated worktree directory |
| `TREE_COMPLETE_HOST` | `127.0.0.1` | Loopback API bind host: `127.0.0.1`, `::1`, or `localhost` |
| `TREE_COMPLETE_PORT` | `4318` | API and production client port |

Environment variables are intentionally server-only. API callers cannot select a repository, command, worktree path, or raw agent prompt. Host and Origin checks keep the unauthenticated API local. Public workspace responses omit absolute host/worktree paths; successful Codex evidence may include at most 40 bounded repository-relative changed-file labels.

## Shape of the system

```text
React Flow canvas
  └─ program version
       ├─ design decision → alternatives → fork request
       └─ child versions
              ↓
Fastify API → validated commit manifest → atomic JSON store → fork orchestrator
                                ├─ preview runner
                                └─ Git worktree → Codex runner

in-progress host → MessagePort API 1.0 → static React client
                 └─ embedded service → the same Fastify/orchestrator stack
```

The shared TypeScript model is the boundary between UI and service. The server owns request validation, branch naming, persistence, and agent execution; the client owns selection and visualization only.

## API

- `GET /api/health` - readiness, runner mode, and availability
- `GET /api/workspace` - project, versions, decisions, runs, bounded result evidence, and curated logs
- `POST /api/forks` - `{ baseVersionId, decisionId, alternativeId }`

The in-progress client maps those public operations to `tree-complete.workspace` and `tree-complete.createFork`. Both transports return the same public `Workspace` and `CreateForkResponse` shapes; host filesystem paths remain redacted.

Only alternatives already defined on the selected decision are accepted. Selecting the current choice, requesting an existing active fork, referring to a mismatched decision, exceeding two active runs, or exhausting the durable public-history budget is rejected before reservation.

# Tree Complete

Tree Complete turns architectural intent into an explorable program lineage. Each tree node is a complete program version; the decisions inside it are live fork points. Pick a different alternative and a coding agent creates a child version without disturbing its parent.

## Run it

Requirements: Node 20.19+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4317`. Preview mode is the default: it exercises validation, persistence, progress, lineage creation, and failure UI without changing a repository.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The production server listens at `http://127.0.0.1:4318` and serves the built client.

## Create a fork

1. Select a decision row inside any version card.
2. Compare the alternatives and their expected impact.
3. Choose a different alternative, then select **Generate fork**.
4. Follow the agent phases in the activity tray. The finished version appears as a child of its base version.

Refreshing the page preserves the preview tree in `.tree-complete/workspace.preview.json`.

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

At startup, the service reads the manifest from the target’s exact committed `HEAD`; dirty manifest edits are ignored. For each request it creates a sanitized `tree-complete/...` branch from the selected version’s immutable full commit, records the selected choice in the fork’s manifest, feeds Codex the structured brief over stdin, and runs it with a workspace-write sandbox. The host then requires implementation changes beyond the manifest, checks the diff, and creates a direct child commit with hooks and signing disabled. The source checkout stays untouched. Failed and successful worktrees remain available for local inspection.

Live mode is intentionally limited to trusted, same-user repositories. Repository instructions and Git filters are code-execution surfaces; untrusted repositories need a separate container or operating-system identity beyond this local tool’s boundary.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TREE_COMPLETE_AGENT_MODE` | `preview` | `preview` or `codex` |
| `TREE_COMPLETE_TARGET_REPO` | - | Trusted absolute Git repository with a committed manifest; required for `codex` |
| `TREE_COMPLETE_DATA_DIR` | `.tree-complete` | State and generated worktree directory |
| `TREE_COMPLETE_HOST` | `127.0.0.1` | Loopback API bind host: `127.0.0.1`, `::1`, or `localhost` |
| `TREE_COMPLETE_PORT` | `4318` | API and production client port |

Environment variables are intentionally server-only. API callers cannot select a repository, command, worktree path, or raw agent prompt. Host and Origin checks keep the unauthenticated API local, and public workspace responses omit filesystem paths.

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
```

The shared TypeScript model is the boundary between UI and service. The server owns request validation, branch naming, persistence, and agent execution; the client owns selection and visualization only.

## API

- `GET /api/health` - readiness, runner mode, and availability
- `GET /api/workspace` - project, versions, decisions, and runs
- `POST /api/forks` - `{ baseVersionId, decisionId, alternativeId }`

Only alternatives already defined on the selected decision are accepted. Selecting the current choice, requesting an existing active fork, or referring to a mismatched decision is rejected.

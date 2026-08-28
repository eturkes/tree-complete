# Project memory

- Product grammar: ready/complete node = realized program version; queued/working/failed child = retained fork attempt. Realized decision rows = fork points; changed alternative → attempt → completed child on success.
- Stack: Node 20.19+, pnpm, TypeScript, React + React Flow, Vite, Fastify, Vitest.
- Ports: Vite `4317` proxies `/api` → Fastify `4318`; production Fastify serves `dist/client`.
- `.tree-complete/project.json` = tracked strict design manifest. Other `.tree-complete/*` = ignored runtime state/worktrees. Target-less preview = demo; targeted preview read-only binds canonical root/branch/committed HEAD, consumes a valid manifest or visibly labels generic fallback, and keys state by target+branch+baseline. Codex requires trusted absolute target + valid committed manifest.
- Integration: `dist/server/server/embedded.js` exports the service, exact-HEAD preflight, and 4 MiB
  response contract. in-progress invokes it only in a one-shot Bubblewrap preview worker with external
  state and read-only repositories. `dist/plugin/in-progress.plugin.json` grants workspace + fork;
  trusted host confirmation gates each fork. Embedded close drains API calls + orchestrator work.
- Security boundary: repository, executable, absolute host/worktree paths, prompt structure = server-owned; API selects known IDs only; loopback Host/Origin enforced. Raw committed reads disable replace objects, grafts + shallow overrides. Public evidence may expose bounded repository-relative labels. Standalone Codex mode runs canonical `codex --yolo exec` with same-user authority; use it only through a coding-agent or Terminal workflow. in-progress never enables that mode. Host validates intended worktree identity + manifest and owns direct-child commit; untrusted input requires container/OS-user isolation.
- Run results: persisted bounded evidence distinguishes measured Codex scope from illustrative preview simulation. Activity center = durable full-history/provenance/timeline/host-check handoff; retries create new runs and retain failed attempts. Pre-reservation admission pessimistically projects all active lifecycles + create envelope under 4 MiB; 429 preserves state, new empty data dir = recovery/new lineage.
- Host browser smoke regeneration: build plugin → launch in-progress against an isolated preview config → use `CHROMIUM_PATH="$(chromiumfish path)"` + sibling `turbo-prompt` Playwright; assert dark context/palette/font, target identity, zero console exceptions/overlay, 390px zero overflow + pointer-opened inspector. Durable port tracked in roadmap.
- Closeout commands: `pnpm typecheck && pnpm test && pnpm build`.

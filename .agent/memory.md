# Project memory

- Product grammar: ready/complete node = realized program version; queued/working/failed child = retained fork attempt. Realized decision rows = fork points; changed alternative → attempt → completed child on success.
- Stack: Node 20.19+, pnpm, TypeScript, React + React Flow, Vite, Fastify, Vitest.
- Ports: Vite `4317` proxies `/api` → Fastify `4318`; production Fastify serves `dist/client`.
- `.tree-complete/project.json` = tracked strict design manifest. Other `.tree-complete/*` = ignored runtime state/worktrees. Preview = safe default; live requires mode `codex` + trusted absolute target whose committed HEAD has a valid manifest.
- Security boundary: repository, executable, absolute host/worktree paths, prompt structure = server-owned; API selects known IDs only; loopback Host/Origin enforced. Public evidence may expose bounded repository-relative labels. Subprocess args array + `shell:false`; Codex config/env constrained; host validates worktree identity + manifest and owns direct-child commit.
- Run results: persisted bounded evidence distinguishes measured Codex scope from illustrative preview simulation. Activity center = durable full-history/provenance/timeline/host-check handoff; retries create new runs and retain failed attempts.
- Closeout commands: `pnpm typecheck && pnpm test && pnpm build`.

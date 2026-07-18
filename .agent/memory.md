# Project memory

- Product grammar: tree node = complete program version; decision rows inside node = fork points; changed alternative → child version.
- Stack: Node 20.19+, pnpm, TypeScript, React + React Flow, Vite, Fastify, Vitest.
- Ports: Vite `4317` proxies `/api` → Fastify `4318`; production Fastify serves `dist/client`.
- `.tree-complete/project.json` = tracked strict design manifest. Other `.tree-complete/*` = ignored runtime state/worktrees. Preview = safe default; live requires mode `codex` + trusted absolute target whose committed HEAD has a valid manifest.
- Security boundary: repository, executable, paths, prompt structure = server-owned; API selects known IDs only; loopback Host/Origin enforced; public state redacts paths. Subprocess args array + `shell:false`; Codex config/env constrained; host validates worktree identity + manifest and owns direct-child commit.
- Closeout commands: `pnpm typecheck && pnpm test && pnpm build`; browser QA via Chromiumfish.

# Contributing

Changes should preserve the zero-dependency Node.js 20+ runtime, non-destructive initialization, write-once verification evidence, selective compatibility with Codex, Claude Code, and GitHub Copilot instruction surfaces, and the development-only boundary. Never make product-runtime agents, loops, schedulers, or orchestrators depend on, read, or write `.harness/`; disabled coding-agent adapters must remain absent across `sync`.

Run before submitting a change:

```bash
npm test
node --check skill/codex-harness/assets/project-runtime.mjs
node --check skill/codex-harness/scripts/lib/core.mjs
```

Never include live API keys, OAuth tokens, subscription credentials, generated `.env` files, or evidence copied from a private project.

# Contributing

Preserve: the zero-dependency Node.js 20+ runtime, non-destructive `init`, in-place `sync` migration of existing projects, the development-only boundary (product runtime never touches `.harness/`), and selective Codex/Claude/Copilot surfaces.

Keep it lean. Before adding a mechanism, name the observed failure it prevents; prefer an executable check over more instruction text, and never add work to every tool call.

Edit the runtime in `skill/codex-harness/assets/project-runtime.mjs` (never `.harness/run.mjs` directly), then refresh this repo's copy with `node bin/agent-harness.mjs sync .`.

```bash
npm test
```

Never include live API keys, OAuth tokens, `.env` files, or evidence copied from a private project.

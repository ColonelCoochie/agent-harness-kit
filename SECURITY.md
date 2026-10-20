# Security Policy

## Supported version

Security fixes target the latest release on `main`.

## Reporting a vulnerability

Do not open a public issue or include real credentials in a report. Use GitHub private vulnerability reporting for this repository, or contact the owner privately through their GitHub profile.

## Credential model

- The harness stores provider names, environment-variable names, round-robin cursors and slot numbers, never credential values.
- Commands run with an allowlisted environment (`security.environmentAllow`) minus every configured provider variable. A command entry receives a key only when it lists that provider in `credentials`, mapped to the provider's `targetEnvironment`. `doctor` rejects allowlists that expose a provider variable.
- Command output is redacted (configured provider values, secret-named environment values, common token formats) before it is written to logs or evidence. Do not put secrets in summaries, commands, paths or commits.
- Executed commands are never retried automatically with another key.

## Process model

Timeouts kill the command's process tree (`taskkill /T /F` on Windows, process group on POSIX). Descendants that deliberately escape that tree are outside cooperative control.

Worker ownership and the handoff barrier are cooperative CLI checks that prevent accidental concurrent mutation. They are not protection against a malicious writer who edits files directly. Evidence records are structural history, not signed attestations.

The only installed host hook is a fail-open PreCompact note; it reads nothing beyond `.harness/` and never blocks the host.

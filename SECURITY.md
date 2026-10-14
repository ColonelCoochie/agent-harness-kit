# Security Policy

## Supported version

Security fixes target the latest released version on the `main` branch.

## Reporting a vulnerability

Do not open a public issue for a vulnerability or include real credentials in a report. Use GitHub's private vulnerability reporting for this repository. If that feature is unavailable, contact the repository owner privately through their GitHub profile.

## Credential model

The harness stores provider names, environment-variable names, rotation cursors, and non-secret slot numbers. It never intentionally writes credential values. Every configured provider source and target name, including custom-provider names, is reserved from `security.environmentAllow`; structural checks reject overlaps and command setup strips the complete reserved set from the ordinary base environment. Verification commands receive only the provider keys they explicitly request, mapped to the requested provider's canonical target environment variable. Command evidence, continuity capsules, and generated progress/handoff projections redact configured provider values and common token forms before persistence, but callers must still avoid placing secrets in summaries, commands, paths, or commits.

Output capture retains an overlap for incomplete credentials, redacts before truncating the stored tail, and omits oversized uninterrupted output spans rather than persisting a token suffix. Metadata records original byte counts and truncation. Command timeouts terminate the ordinary descendant tree with a POSIX process group or Windows taskkill and bound the wait for inherited output pipes. Detached descendants deliberately escaping the command group remain outside cooperative command execution.

Ownership is cooperative CLI enforcement. Native Claude worker identity comes from reviewed SubagentStart/PreCompact `agent_id`, never shared `session_id`; manual hosts attest a distinct ID on every mutation. Explicit recovery requires the expected owner, a reason, and host/operator confirmation of termination. It retires the former ID and records the attestation without pretending to authenticate a native worker's liveness.

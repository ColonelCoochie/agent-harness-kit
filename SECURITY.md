# Security Policy

## Supported version

Security fixes target the latest released version on the `main` branch.

## Reporting a vulnerability

Do not open a public issue for a vulnerability or include real credentials in a report. Use GitHub's private vulnerability reporting for this repository. If that feature is unavailable, contact the repository owner privately through their GitHub profile.

## Credential model

The harness stores provider names, environment-variable names, rotation cursors, and non-secret slot numbers. It never intentionally writes credential values. Verification commands receive only the provider keys they explicitly request, mapped to the provider's canonical target environment variable. Command evidence, continuity capsules, and generated progress/handoff projections redact configured provider values and common token forms before persistence, but callers must still avoid placing secrets in summaries, commands, paths, or commits.

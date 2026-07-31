# Goal Loop

## Goal

State one durable objective.

## Acceptance criteria

- [ ] Add machine-verifiable conditions.

## Scope

### Allowed

- Add explicit paths.

### Hands off

- Add explicit paths.

## Verification

1. Run the feature acceptance commands.
2. Run the configured full verification level.
3. Run E2E and architecture checks when the behavior crosses boundaries.

## Stop conditions

- All acceptance criteria pass.
- Maximum attempts from `.harness/config.json` is reached.
- The same failure repeats without new evidence.
- A human decision or new authority is required.

## External state

Update `.harness/progress.md`, `.harness/handoff.md`, and evidence after every round.

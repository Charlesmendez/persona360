# Contributing

Thanks for contributing to `persona360`.

## Workflow

1. Fork the repo.
2. Create a branch from `main`.
3. Make focused changes.
4. Run the local checks.
5. Open a pull request.

## Local setup

```bash
pnpm install
pnpm setup:native
pnpm build
```

## Required checks

Before opening a PR, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Contribution guidelines

- Prefer small PRs over large mixed changes.
- Keep changes scoped to one concern.
- Update docs/examples when CLI behavior or payloads change.
- If you change contracts, keep `packages/contracts` as the source of truth.
- If you change business rules, put them in `packages/domain`, not the CLI.
- If you change graph behavior, keep traversal/ranking in `packages/graph`.
- If you add agent workflow behavior, keep the CLI deterministic and machine-readable.

## Pull requests

- Use a clear title.
- Explain the why, not just the what.
- Include a short test plan.
- Link relevant issues if they exist.

## Branch policy

- Do not push directly to `main`.
- Open a PR and wait for review.

## Questions

If the change is large or touches architecture, open an issue or draft PR first.

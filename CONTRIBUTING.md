# Contributing to evidence-cli

Thank you for your interest in contributing! evidence-cli is an open,
framework-agnostic format for what a test run produced. Contributions to the
**format**, the **validator/CLI**, and the **docs** are all welcome.

## The decision comes first

evidence-cli is governed by a living decision log — **the decision is the unit of
work, and code is downstream of it** (see [GOVERNANCE.md](GOVERNANCE.md)). Any
change to behavior, schema, or contract starts as a decision record in
[`design/decisions/`](design/decisions), and no code lands without one. This is
what keeps the format trustworthy for the frameworks that adopt it.

## What you can contribute

- **Format & decisions** — propose or amend a decision (proposition → options →
  decision → reasoning) under `design/decisions/`.
- **Validator & CLI** — implementation in `src/`, written test-first.
- **Conformance fixtures** — add a pack under `fixtures/` with an `expected.yaml`
  sidecar; the conformance harness picks it up automatically.
- **Docs** — the contract pages in `design/contract/`, the schemas, and this README.

## How to contribute

1. **Fork** the repository.
2. **Create a branch** from `main` (`git checkout -b my-change`).
3. For a behavior/schema/contract change, **add or amend a decision first**.
4. **Make your changes test-first** — `npm test` green and `npx tsc --noEmit` clean.
5. **Open a Pull Request** against `main`.

## Guidelines

- Keep changes focused — one PR per topic.
- Every key in the format is `snake_case`.
- Follow the existing style; keep commits focused and descriptive.
- The conformance suite and the type check run in CI on every PR.

## Reporting bugs & requesting features

Use [GitHub Issues](https://github.com/LambdaTest/evidence-cli/issues/new/choose)
to report bugs or request features. Both humans and AI agents are welcome to file
issues.

## Code of Conduct

All participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

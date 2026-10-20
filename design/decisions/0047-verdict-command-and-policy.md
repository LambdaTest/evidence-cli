---
id: 47
slug: verdict-command-and-policy
title: Verdict command — judging a pack against a policy of gates
status: accepted
date: 2026-10-21
proposition: >
  A pack holds facts (0012) and the per-test verdicts the producer authored
  (0006). A team still needs one answer for a release: "does this run meet our
  bar?" What does a policy look like, how is a pack judged against it, how are
  problems in the policy itself reported, and what does the judgement produce?
options:
  - id: policy-of-gates
    summary: >
      A small YAML policy of named gates — a metric compared with one operator
      (equals/min/max/range/in), optionally narrowed per test with `where`, or a
      boolean CEL `expr`. `evidence verdict <pack> --policy <f>…` checks the
      policy first (every problem at once, with codes and hints), then judges
      each gate and writes one verdict file per policy beside the pack.
    chosen: true
  - id: expressions-only
    summary: Every gate is a free CEL expression; no metric/operator form.
    chosen: false
  - id: verdict-in-validate
    summary: >
      Fold thresholds into `validate` profiles, so an invalid pack and a pack that
      misses the bar look the same.
    chosen: false
decision: >
  `evidence verdict <pack> --policy <f>… [-o dir] [--json]` judges a pack (live
  directory or sealed zip) against one or more policies and writes
  `<policy-id>.verdict.json` for each into `-o` (default: the pack's own
  directory). It NEVER modifies the pack (0050). A POLICY is
  `{policy: <id>, requires?: {catalog, version?}, gates: [...]}`; the id is
  file-name safe because it names the verdict file. A GATE is `{id, severity:
  blocking|warning, message?}` plus EITHER `metric` with exactly one operator
  (`equals`, `min`, `max`, `range: [lo, hi]`, `in: [...]`) and an optional
  `where`, OR `expr` (a CEL expression that must be a bool) with no operator.
  Metric names come from catalogs (0048): built-ins are unprefixed
  (`totals.failed`, `pass_rate`), producer metrics are always `metrics.<name>`.
  A metric's catalog `type` fixes which operators are allowed and what a
  threshold may be; `where` is allowed only on a `per_test` metric. The policy
  file is TOOL INPUT, validated by `src/schemas/policy.schema.json` beside the
  versioned tree, and unknown keys are rejected. THE POLICY IS CHECKED BEFORE
  ANY GATE RUNS, and every problem is reported in one pass as a Diagnostic
  `{code, severity, location, message, hint?, line?, column?}` — codes
  `policy.parse`, `policy.schema`, `policy.unknown_key`, `policy.duplicate_gate`,
  `policy.unknown_metric`, `policy.builtin_prefixed`, `policy.op_not_allowed`,
  `policy.value_type`, `policy.where_not_per_test`, `policy.expr_syntax`,
  `policy.expr_type`, `policy.catalog_required`, and the warning
  `policy.catalog_needed` (a `metrics.*` gate or `requires` checked with no
  catalog to check it against). The same check is exported as
  `lintPolicy(text, {catalog})` and runs as `evidence verdict --lint --policy
  <f>… [--catalog <file>]` with no pack and no network. JUDGING: the pack must
  be `finalized` (else the verdict is errored, `verdict.unfinalized`) and must
  pass L0 validation (else `verdict.pack_invalid`); a policy problem found
  against THIS pack's catalog errors the whole verdict with that problem, while
  a problem that makes the policy unreadable (parse, schema, unknown key,
  duplicate gate) is a usage error and no verdict is written.
  Each gate resolves its metric (0048) and compares; a value that cannot be
  resolved, a type mismatch, an out-of-range value, or a stored number that
  disagrees with its recompute ERRORS the gate — never a silent pass. Gate
  status is `pass`, `fail` (blocking), `warn` (warning severity failed), or
  `errored`. The verdict `result` is `errored` if the policy errored or any
  gate errored (whatever its severity), else `fail` if any blocking gate
  failed, else `pass`. The verdict document (`src/schemas/verdict.schema.json`)
  carries `result, evaluated_at, evaluator, pack {run_id, sha256, contract},
  policy {id, sha256}, catalog, error, gates[], failed_gates, warnings,
  errored_gates, exit_code`. Library: `verdict(pack, {policies})`, `judge(facts,
  policy, catalogs)`, `lintPolicy(text, {catalog})`, `loadPolicy(text)`,
  `loadPackFacts(pack)`.
governs:
  - design/contract/03-commands.md
  - src/schemas/policy.schema.json
  - src/schemas/verdict.schema.json
  - src/verdict
  - src/cli.ts
feature: [verdict]
depends_on: [12, 6, 17, 37, 45]
supersedes: []
---

## Reasoning

**Why a separate command, not `validate`.** `validate` answers "is this a
well-formed pack?"; a policy answers "is this run good enough?". Folding
thresholds into validation (`verdict-in-validate`) would make a malformed pack
and a pack that missed the bar indistinguishable, and would push team-specific
bars into the open format's profiles. A separate verb keeps validation about
the contract and lets the same sealed pack be judged later against a different
policy.

**Why metric gates as well as expressions.** Most bars are one number against
one threshold. Writing `metric: totals.failed, equals: 0` lets the tool check
the gate statically against the metric's catalog entry — the operator against
the type, the threshold against the range, `where` against `per_test` — and
report a precise, fixable problem before anything runs. An expression-only
format (`expressions-only`) loses all of that: every gate is opaque until it is
evaluated. The `expr` form stays for the bars that are not one number.

**Why the policy is checked first, all at once.** A policy author fixing a file
wants the whole list, with the line and a hint, not one error per run. A policy
problem is the author's to fix, so it is never reported as a `fail` of the
product; against a given pack it is `errored`, and when the file itself cannot
be read it is a usage error.

**Why fail closed.** A gate whose value cannot be produced, or whose stored
number disagrees with the raw facts, is `errored`. A verdict that passed
because a number was missing would be worse than no verdict.

## Consequences

- New `src/verdict/` module (policy loader, lint, catalog loader, CEL wrapper,
  metric resolver, evaluator, pack facts) and the `evidence verdict` command.
- New tool schemas `policy.schema.json` and `verdict.schema.json`, registered
  in `src/schemas/registry.ts` beside `metrics-catalog.schema.json` (0048).
- `Diagnostic` gains optional `hint`, `line` and `column` (additive).
- `design/features.yaml` gains the `verdict` feature; `03-commands.md` gains the
  `## verdict` section.
- Deferred: per-policy trust requirements (e.g. blocking gates must be
  `recomputed`), waivers and overrides, signing a verdict (L3), and expressions
  that reference other metrics by name.

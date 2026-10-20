---
id: 49
slug: expression-language-cel
title: Expression language — CEL, with sum/mean/percentile and a cost limit
status: accepted
date: 2026-10-21
proposition: >
  Policies and catalogs need expressions in three places: a gate's `where`, a
  gate's `expr`, and a catalog metric's `verify.expr` / aggregate `value` and
  `where`. They must be rich enough for filters and aggregates over tests, safe
  to run on untrusted input, deterministic, and portable — a second
  implementation of the open format, in Go or Python, must give the same
  verdict. Which language, which JS implementation, and what exactly does an
  expression see?
options:
  - id: cel
    summary: >
      CEL (Common Expression Language): not Turing-complete, specified, with
      Go/Java/C++/JS/Python implementations; aggregates added as registered
      functions.
    chosen: true
  - id: jsonata
    summary: Strong JSON querying, one mature JS library, weak outside JS.
    chosen: false
  - id: own-grammar
    summary: A small Pratt-parsed grammar owned by evidence-cli.
    chosen: false
decision: >
  Expressions are CEL. The JS implementation is `@marcbachmann/cel-js` (^8,
  MIT, zero dependencies): it implements the macros the format needs (`all`,
  `exists`, `exists_one`, `map`, `filter`, `has`), has a static type checker
  used by lint, and enforces parse-time structural limits. It ships as an ES
  module only, so the package's `engines` becomes `node >=20.19` (the first 20.x
  that loads an ES module from CommonJS without a flag). WHAT AN EXPRESSION
  SEES — pack context (gate `expr`, catalog `verify.expr`): `run` (run.yaml as
  parsed), `tests` (one fact per top-level test, sorted by id), `totals`
  (`{tests, passed, failed, broken, skipped}` counted from `tests`), `failures`
  (the rows of the root failure.yaml index, `[]` when absent). Test context
  (gate `where`, aggregate `value`/`where`): `test`, `file` (the parsed per-test
  `over` file), `run`. A TEST FACT is the parsed result.yaml plus `id` (its
  folder name), with `tags`, `requirements` and `steps` read as `[]` and `flaky`
  as `false` when absent. When a per_test metric is narrowed by `where`,
  `tests` and `totals` cover only the tests `where` holds for. NUMBERS follow
  CEL's JSON model: every number read from a pack file is a `double`; counts the
  tool computes (`totals.*`, `size()`) are `int`; mixing them in arithmetic
  needs an explicit `double()`/`int()`, as in every CEL implementation;
  comparisons across int and double are allowed. REGISTERED FUNCTIONS, part of
  the format so every implementation adds the same set: `sum(list)` (int list →
  int, double list → double, empty → 0), `mean(list)` → double, and
  `percentile(list, p)` → double, nearest-rank (`p` in [0, 100], the value at
  rank ceil(p/100 × n)); `mean` and `percentile` of an empty list are errors.
  LIMITS: at most 1000 AST nodes and nesting depth 32 at parse time, and at
  most 1,000,000 list-element reads from the facts per evaluation; exceeding
  either is an error. A double result that is not finite (a division by zero)
  is an error. CEL has no clock and no I/O and the registered functions are
  pure, so the same facts always give the same value. Any evaluation error
  errors the gate (`verdict.expr_error`); a parse error is `policy.expr_syntax`
  and a type error (including an unknown variable, or a gate expression that
  cannot be a bool) is `policy.expr_type`.
governs:
  - src/verdict/expr.ts
  - package.json
feature: [verdict]
depends_on: [37, 47, 48]
supersedes: []
---

## Reasoning

**Why CEL.** It was built for exactly this — policy over data — and is used
that way by Kubernetes admission and Envoy. It cannot loop forever, and it has
a written specification with several independent implementations, which is
what an open format with a conformance suite needs: a Go implementer uses
cel-go and gets the same answers. JSONata is a better JSON query language but
lives almost only in JS and is harder to bound. An own grammar would need no
dependency, but every other implementer would have to rebuild it and the
format would own its edge cases forever.

**Why `@marcbachmann/cel-js`.** Three JS options were checked. `cel-js`
(ChromeGG) is slower and less complete. `@bufbuild/cel` runs the official
conformance suite but needs the protobuf runtime and spec packages (~10 MB),
works on protobuf values rather than plain objects, and has no parse limits.
`@marcbachmann/cel-js` takes plain JS objects, has no dependencies, has a type
checker (so lint can reject `'a' + 1` or an unknown variable before any pack
is opened), and has structural limits. Its ES-module-only packaging is the cost:
Node 18 is past end of life, and kane-cli bundles evidence-cli, so raising
`engines` to `>=20.19` breaks no supported consumer.

**Why these variables and defaults.** `tests`/`test` follow the per-test
result.yaml so authors write what the pack says. Reading absent `tags` as `[]`
and absent `flaky` as `false` lets `'checkout' in test.tags` work on every
test instead of erroring on the ones without tags; absence already means "no
tags" and "not retried" in the 0.1 contract.

**Why a runtime cost limit on top of parse limits.** Nested comprehensions
(`tests.all(a, tests.all(b, …))`) are small expressions with large cost. Parse
limits bound the expression; counting list-element reads bounds the work, and
the count is the same for the same input, so the limit is deterministic too.

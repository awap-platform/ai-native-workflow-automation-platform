# ADR-0010: Keep the SCRIPT node on a deny-by-construction expression sandbox

- **Status:** Accepted
- **Date:** 2026-11-16
- **Issue:** #298
- **Related:** #132 (SCRIPT node), #306 (network/sandbox-escape tests), `docs/ai-and-script-security.md`

## Context

The platform plan originally described the SCRIPT node as a sandbox limited to whitelisted
libraries. The implemented sandbox is stricter than that wording: it does not run a language
runtime at all. `ScriptSandbox` parses a script into a tiny expression grammar and evaluates the
resulting tree in-process. The grammar can express numbers, strings, booleans, `ctx.field` reads,
arithmetic, comparisons, boolean logic and five pure functions (`len`, `upper`, `lower`,
`coalesce`, `abs`); it cannot express imports, method calls, reflection, loops, assignments, file or
network I/O.

This divergence matters to security reviewers and auditors: a literal reading of "whitelisted
libraries" suggests a runtime with an allowlist, while the implementation has no runtime and no
libraries at all. An undocumented deviation can be treated as a compliance gap, so this ADR records
the decision.

## Decision

**Keep the deny-by-construction expression sandbox as the default and only SCRIPT execution model.**
It is not weakened to accept libraries. The node stays fail-closed behind `SCRIPT_NODE_ENABLED=false`.

The comparison below is the basis for the decision:

| Dimension | Whitelist-library runtime (rejected) | Deny-by-construction expression sandbox (chosen) |
|---|---|---|
| Attack surface | Language runtime, standard library, allowlisted libraries, classloader, JNI, native code | One recursive-descent parser plus five pure functions |
| Host access | Must be denied by policy; one missing rule is an RCE | Not expressible in the grammar |
| Network access | Blocked by sandbox policy, proxy, or network namespace | No socket, URL, DNS or HTTP primitive exists |
| Reflection / class loading | Requires a deny rule and a hardened classloader | No identifier resolution beyond `ctx`, `true`, `false`, `null` and function names |
| Resource limits | Needs CPU/memory limits and a supervisor process | Mandatory timeout, script-size cap and output-size cap in-process |
| Supply chain | Every allowlisted library adds a CVE and licence obligation | No script dependencies |
| Auditor evidence | Only as strong as the allowlist and its review process | Grammar and denylist tests enumerate every construct |
| Expressiveness | Loops, collections, libraries | Arithmetic, comparisons, boolean logic, string concatenation, `ctx` reads |
| Operational cost | Worker/WASM/container pool, image lifecycle | Virtual-thread call behind a timeout |

The weaker expressiveness is intentional. The documented use case is routing/validation logic over
the node's `ctx` map, which the expression grammar covers. A future need for loops or libraries does
not justify weakening this sandbox; it requires a **separate** worker-container or WASM runtime with
its own ADR, resource limits, library allowlist, image provenance and security review. The current
sandbox stays the default.

## Allowed grammar

```
expression   := or
or           := and ("or" and)*
and          := comparison ("and" comparison)*
comparison   := additive (("==" | "!=" | "<=" | ">=" | "<" | ">") additive)?
additive     := multiplicative (("+" | "-") multiplicative)*
multiplicative := unary (("*" | "/" | "%") unary)*
unary        := ("not" | "-") unary | primary
primary      := number | string | "true" | "false" | "null" | "ctx" path | "(" expression ")"
               | function "(" arguments ")"
path         := ("." identifier)*        // map reads only; no calls
function     := "len" | "upper" | "lower" | "coalesce" | "abs"
```

- Only JSON-compatible context values are read. The map is the only data source; environment
  variables, system properties and Spring beans are unreachable.
- No assignment, sequencing, loops, lambdas, classes, imports, method calls, indexing, comments or
  statement separators exist in the grammar.
- Identifier resolution is closed: anything other than `ctx`, the three literals and the five
  function names is rejected.

## Limits

| Limit | Default | Enforcement |
|---|---|---|
| Script size | 4 000 chars (`MAX_SCRIPT_CHARS`) | Rejected before parsing |
| Timeout | 10 000 ms (`awap.script.timeout-ms`) | `Future.get` on a virtual thread; timeout cancels and fails with `TIMEOUT` |
| Output size | 8 192 chars (`awap.script.max-output-chars`) | Rejected after evaluation, before the value leaves the sandbox |
| Context size | 32 KiB (`awap.script.max-context-chars`) | Rejected by the node service before evaluation |
| Node enablement | `SCRIPT_NODE_ENABLED=false` | Fail-closed `501` when disabled |

## Residual risk

- **Parser bugs.** The residual risk is a parser defect that evaluates something outside the
  grammar. Mitigations: strict recursive-descent parser that rejects any trailing character, no
  identifier resolution outside the closed set, fail-closed default, full security matrix and
  deterministic fuzz/property tests in CI (`ScriptSandboxSecurityMatrixTest`), and audit of every
  run. A parser bug still cannot reach the host unless it also bypasses identifier resolution and
  method-call rejection, which the matrix tests exercise explicitly.
- **Resource exhaustion inside the grammar.** Deeply nested expressions or very large numeric
  literals are bounded by the script-size cap and the timeout. Memory exhaustion from context size
  is bounded by the context cap.
- **Audit payload.** Audit rows store a hash and the outcome, not the raw script/context, so secrets
  in a context do not leak into the audit trail.

## Consequences

- The SCRIPT capability is documented as **deny-by-construction**, not as a whitelist-library
  runtime. The compliance inventory links to this ADR as the approved deviation.
- Every new operator or function requires a security review, a new ADR revision and a new matrix
  test; silent extension is not allowed.
- Richer scripting, if approved, is delivered by a separate sandbox (worker container/WASM) that
  never shares this process.

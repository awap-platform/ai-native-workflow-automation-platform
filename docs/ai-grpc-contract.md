# Backend <-> AI-layer gRPC contract (issue #291)

The backend and the AI layer share one versioned protobuf contract:

```
contracts/proto/ai/v1/copilot.proto    # source of truth
contracts/proto/ai/v1/baseline.json    # compatibility baseline (generated)
```

REST remains supported. The transport is selected by `awap.ai.copilot.transport`:

| Value | Behaviour |
|---|---|
| `rest` (default) | All Copilot calls use the existing HTTP JSON client. |
| `grpc` | `/api/v1/copilot/chat` uses gRPC; every other endpoint stays on REST. |

If a gRPC call fails with a retryable transport status (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, ...) the
backend falls back to REST for the same request and increments
`awap.ai.transport.fallback{reason=...}`. Authentication/authorization/validation failures
(`UNAUTHENTICATED`, `PERMISSION_DENIED`, `INVALID_ARGUMENT`) are terminal and are mapped to
`401`/`403`/`400` without a second call.

## Messages

| Message | Purpose |
|---|---|
| `SecurityContext` | Tenant, user, role, permissions, correlation id, access token. |
| `CopilotRequest` | Message, action, context (`Struct`), idempotency key, high-risk flag, security, deadline. |
| `ToolCall` | Tool name, arguments (`Struct`), result (`Value`), ok flag, error. |
| `CopilotResponse` | The same envelope as REST, including prompt key/version/hash and `cache_hit`. |
| `AiError` | Typed error code, message and retryable flag. |
| `AuditEvent` | Immutable audit record for one Copilot turn. |
| `CopilotService.Chat` | The single unary RPC. |

`google.protobuf.Value` is used for tool results and response data so arrays, objects and scalars
survive the round trip exactly.

## Metadata, deadlines and idempotency

The backend sends the caller's context as gRPC metadata:

| Header | Meaning |
|---|---|
| `x-tenant-id`, `x-user-id`, `x-user-role` | Authenticated caller (required). |
| `x-user-permissions` | Comma-separated effective permissions. |
| `x-ai-service-token` | Backend service credential (`AI_LAYER_SERVICE_TOKEN`). |
| `x-correlation-id` | Correlation id; echoed in the response. |
| `idempotency-key` | Tenant-scoped idempotency key for state-changing actions. |

The deadline is the backend `awap.ai.copilot.timeout-ms` value. The AI layer also honours the
request's `deadline_ms` (the smaller of the two) and maps expiry to
`DEADLINE_EXCEEDED` with `ai-error-code=DEADLINE_EXCEEDED` trailing metadata. A missing/invalid
service token is `UNAUTHENTICATED`; a body tenant that differs from the metadata tenant is
`PERMISSION_DENIED`; blank or oversized messages are `INVALID_ARGUMENT`.

## Parity

- `ai-layer/tests/test_grpc_contract.py` asserts that a REST response and the gRPC response
  normalize to the same proto projection for the same fixture, and that tool calls/results keep
  their exact types.
- `GrpcCopilotTransportTest` asserts that the Java client maps every request field and metadata
  item and that the JSON envelope keeps proto field names (`requires_human_approval`, `cache_hit`,
  ...), which is the REST contract.

## Regenerating stubs

Python stubs are committed so `uv sync --locked` needs no compiler:

```bash
cd ai-layer
uv run python -m grpc_tools.protoc \
  -I ../contracts/proto \
  -I "$(uv run python -c 'import grpc_tools, os; print(os.path.join(os.path.dirname(grpc_tools.__file__), "_proto"))')" \
  --python_out=. --grpc_python_out=. ../contracts/proto/ai/v1/copilot.proto
```

Java stubs are generated during `generate-sources` by `protobuf-maven-plugin` using the pinned
`protoc` and `protoc-gen-grpc-java` versions in `backend/pom.xml`.

## Compatibility rules

- Never reuse or renumber a field.
- Never change a field's type or label (`optional`/`repeated`/map).
- Adding fields, enum values and RPCs is backward compatible.
- Removing a field, message, enum value, service or RPC requires a coordinated migration window.

Run locally:

```bash
node --test "scripts/test/check-proto-compatibility.test.mjs"
node scripts/check-proto-compatibility.mjs
```

When a breaking change is intentional and reviewed, update the baseline with
`node scripts/check-proto-compatibility.mjs --write`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `awap.ai.copilot.transport` | `rest` | `rest` or `grpc`. |
| `awap.ai.copilot.grpc.host` | `localhost` | AI-layer gRPC host. |
| `awap.ai.copilot.grpc.port` | `50051` | AI-layer gRPC port. |
| `AI_GRPC_HOST` / `AI_GRPC_PORT` | unset | Start the AI-layer gRPC server when the port is set. |
| `AI_LAYER_SERVICE_TOKEN` | empty | Shared service credential; required when configured. |

# AI_TASK `EXTRACT` action (issue #287)

`EXTRACT` turns unstructured text into schema-validated JSON that downstream nodes can consume.

## Node configuration

```json
{
  "type": "AI_TASK",
  "id": "extract-invoice",
  "config": {
    "action": "EXTRACT",
    "prompt": "Extract the invoice fields from the incoming document.",
    "schema": {
      "version": "v1",
      "required": ["vendor", "amount"],
      "properties": {
        "vendor": {"type": "string", "maxLength": 120},
        "amount": {"type": "number"},
        "dueDate": {"type": "string"},
        "category": {"type": "string", "enum": ["INVOICE", "RECEIPT"]}
      }
    }
  }
}
```

`schema` may be an inline object or a JSON string. Supported property types are `string`,
`number`, `integer`, `boolean`, `object` and `array`. `required`, `enum` and `maxLength` are
enforced. The definition service rejects an `EXTRACT` node without a schema, or with an invalid
schema, at create/publish time.

## Execution contract

1. The prompt and input pass the existing AI guardrails (injection markers, input size).
2. The model is asked for JSON-only output and the selected model tier is used.
3. Output guardrails reject empty/leaking responses.
4. The schema validator rejects malformed JSON, non-object roots, missing required fields, unknown
   fields, wrong types, enum violations and `maxLength` violations. Nothing unvalidated can reach a
   downstream node.
5. Low confidence still routes to the existing HITL task path.

The audit row records `outcome=SUCCESS`/`HITL` and a detail such as
`schema=v1; fields=4; validation=VALID`. A validation failure is audited as `VALIDATION_FAILED`
and the node fails with `422`; the workflow does not execute downstream nodes.

## Deterministic local extractor

`LocalHeuristicAiBackend` handles `extract:` prompts offline. It recognises `vendor:`, `amount:`,
`due date:`/`dueDate:` and `category:` fields and emits deterministic JSON. This keeps tests and
offline deployments working without an external model; the external OpenAI-compatible adapter uses
the same prompt contract and returns real model JSON.

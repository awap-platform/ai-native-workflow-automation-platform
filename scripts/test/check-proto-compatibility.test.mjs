import assert from "node:assert/strict";
import { test } from "node:test";
import { compareContract, parseProto, stripComments } from "../check-proto-compatibility.mjs";

const PROTO = `
syntax = "proto3";
package ai.v1;
import "google/protobuf/struct.proto";

message CopilotRequest {
  string message = 1;
  optional string action = 2;
  google.protobuf.Struct context = 3;
  repeated string permissions = 4;
  map<string, string> labels = 5;
}

enum ErrorCode {
  ERROR_CODE_UNSPECIFIED = 0;
  INVALID_ARGUMENT = 1;
}

service CopilotService {
  rpc Chat(CopilotRequest) returns (CopilotResponse);
}
`;

function currentWith(overrides) {
  const base = parseProto(PROTO);
  return {
    ...base,
    ...overrides,
  };
}

test("comments are stripped without removing adjacent content", () => {
  assert.equal(stripComments("a // x\nb /* y */ c"), "a \nb  c");
});

test("messages, optional/repeated/map fields, enums and RPCs are parsed", () => {
  const contract = parseProto(PROTO);

  assert.deepEqual(contract.messages.CopilotRequest.fields[1], {
    name: "message",
    type: "string",
    label: "singular",
  });
  assert.equal(contract.messages.CopilotRequest.fields[2].label, "optional");
  assert.equal(contract.messages.CopilotRequest.fields[3].type, "google.protobuf.Struct");
  assert.equal(contract.messages.CopilotRequest.fields[4].label, "repeated");
  assert.equal(contract.messages.CopilotRequest.fields[5].type, "map<string, string>");
  assert.deepEqual(contract.enums.ErrorCode.values, {
    0: "ERROR_CODE_UNSPECIFIED",
    1: "INVALID_ARGUMENT",
  });
  assert.deepEqual(contract.services.CopilotService.methods.Chat, {
    input: "CopilotRequest",
    output: "CopilotResponse",
  });
});

test("an identical contract passes", () => {
  assert.deepEqual(compareContract(parseProto(PROTO), parseProto(PROTO)), {
    ok: true,
    errors: [],
  });
});

test("adding fields and RPCs is backward compatible", () => {
  const baseline = parseProto(PROTO);
  const current = parseProto(
    PROTO.replace(
      "  map<string, string> labels = 5;",
      "  map<string, string> labels = 5;\n  bool new_field = 6;",
    ).replace(
      "  rpc Chat(CopilotRequest) returns (CopilotResponse);",
      "  rpc Chat(CopilotRequest) returns (CopilotResponse);\n  rpc Health(CopilotRequest) returns (CopilotResponse);",
    ),
  );

  assert.equal(compareContract(baseline, current).ok, true);
});

test("removed, renamed, retyped and renumbered fields are breaking", () => {
  const current = currentWith({
    messages: {
      CopilotRequest: {
        fields: {
          1: { name: "text", type: "string", label: "singular" },
          3: { name: "context", type: "float", label: "singular" },
        },
      },
    },
  });
  const renumbered = parseProto(PROTO.replace("string message = 1;", "string message = 9;"));

  const result = compareContract(parseProto(PROTO), current);
  const renumberResult = compareContract(parseProto(PROTO), renumbered);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("field 5 (labels) was removed")));
  assert.ok(result.errors.some((error) => error.includes("field 1 renamed message -> text")));
  assert.ok(result.errors.some((error) => error.includes("field 3 type changed")));
  assert.ok(result.errors.some((error) => error.includes("field 2 (action) was removed")));
  assert.ok(
    renumberResult.errors.some((error) => error.includes("field message renumbered 1 -> 9")),
  );
});

test("removed messages, enum values, services and RPCs are breaking", () => {
  const current = {
    messages: {},
    enums: { ErrorCode: { values: { 0: "ERROR_CODE_UNSPECIFIED" } } },
    services: { CopilotService: { methods: {} } },
  };

  const result = compareContract(parseProto(PROTO), current);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("message CopilotRequest was removed"));
  assert.ok(result.errors.includes("enum ErrorCode: value 1 (INVALID_ARGUMENT) was removed or renamed"));
  assert.ok(result.errors.includes("service CopilotService: rpc Chat was removed"));
});

test("an RPC signature change is breaking", () => {
  const current = parseProto(
    PROTO.replace(
      "rpc Chat(CopilotRequest) returns (CopilotResponse);",
      "rpc Chat(CopilotRequest) returns (CopilotRequest);",
    ),
  );

  const result = compareContract(parseProto(PROTO), current);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("service CopilotService: rpc Chat signature changed"));
});

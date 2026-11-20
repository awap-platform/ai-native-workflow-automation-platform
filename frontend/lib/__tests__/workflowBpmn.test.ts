import {
  MAX_BPMN_LENGTH,
  bpmnErrorLine,
  describeBpmnError,
  isSafeBpmnPayload,
} from "../workflowBpmn";

describe("BPMN UI helpers", () => {
  it("extracts the line from the backend problem detail", () => {
    expect(bpmnErrorLine("Invalid BPMN at line 12: XML is not well-formed")).toBe(12);
    expect(bpmnErrorLine("No line here")).toBeNull();
  });

  it("keeps the line reference in the displayed error", () => {
    expect(describeBpmnError(new Error("Invalid BPMN at line 4: no process"))).toBe(
      "Invalid BPMN at line 4. Invalid BPMN at line 4: no process",
    );
    expect(describeBpmnError(new Error(""))).toBe("The BPMN operation failed.");
    expect(describeBpmnError("boom")).toBe("boom");
  });

  it("treats NUL-containing or empty payloads as unsafe and exposes the size limit", () => {
    expect(isSafeBpmnPayload("<bpmn:definitions/>")).toBe(true);
    expect(isSafeBpmnPayload("")).toBe(false);
    expect(isSafeBpmnPayload("a\u0000b")).toBe(false);
    expect(MAX_BPMN_LENGTH).toBe(1_000_000);
  });
});

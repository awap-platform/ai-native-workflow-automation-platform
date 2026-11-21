package com.awap.form.interfaces.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Public representation of a form submission, including the accepted file metadata. */
public record FormSubmissionResponse(
    UUID id,
    UUID formId,
    int formVersion,
    UUID workflowInstanceId,
    String dataJson,
    UUID submittedBy,
    Instant createdAt,
    List<FormSubmissionFileResponse> files) {

  public FormSubmissionResponse withFiles(List<FormSubmissionFileResponse> acceptedFiles) {
    return new FormSubmissionResponse(
        id,
        formId,
        formVersion,
        workflowInstanceId,
        dataJson,
        submittedBy,
        createdAt,
        acceptedFiles);
  }
}

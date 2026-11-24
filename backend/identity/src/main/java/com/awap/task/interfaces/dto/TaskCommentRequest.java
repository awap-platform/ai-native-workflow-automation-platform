package com.awap.task.interfaces.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** New task comment. Author and timestamp always come from the session. */
public record TaskCommentRequest(
    @NotBlank(message = "body is required") @Size(max = 10_000, message = "body is too long")
        String body) {}

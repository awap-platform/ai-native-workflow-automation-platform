package com.awap.task.interfaces.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/** Links an already-uploaded document file to a task. */
public record TaskAttachmentRequest(@NotNull(message = "fileId is required") UUID fileId) {}

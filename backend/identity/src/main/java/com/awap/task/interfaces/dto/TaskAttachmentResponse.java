package com.awap.task.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/** Task attachment with the scan state copied from the document pipeline. */
public record TaskAttachmentResponse(
    UUID id,
    UUID taskId,
    UUID fileId,
    String fileName,
    String scanStatus,
    boolean downloadable,
    UUID createdBy,
    Instant createdAt) {}

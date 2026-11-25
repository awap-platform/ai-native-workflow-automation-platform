package com.awap.document.interfaces.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

/** Request to start a resumable upload (issue #372). */
public record InitiateMultipartRequest(
    @NotBlank String name, String contentType, @Positive long size, @NotBlank String sha256) {}

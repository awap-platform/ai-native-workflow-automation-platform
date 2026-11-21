package com.awap.identity.interfaces.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Read-only break-glass governance record.
 *
 * <p>{@code available=false} is returned when the committed resource cannot be read. The console
 * renders an explicit unavailable state instead of pretending there were no exceptions.
 */
public record BreakGlassLogResponse(boolean available, JsonNode log) {}

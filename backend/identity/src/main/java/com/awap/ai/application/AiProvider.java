package com.awap.ai.application;

import java.util.List;

/**
 * Provider SPI (issue #292). Every adapter exposes the same capability and model catalogue, reports
 * normalized health and returns provider-neutral errors.
 */
public interface AiProvider {

  String id();

  List<AiModel> models();

  boolean healthy();

  /** Returns the normalized completion or throws {@link AiProviderException}. */
  String complete(AiProviderRequest request);
}

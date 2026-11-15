package com.awap.ai.infrastructure;

import com.awap.ai.application.AiCapability;
import com.awap.ai.application.AiModel;
import com.awap.ai.application.AiProvider;
import com.awap.ai.application.AiProviderException;
import com.awap.ai.application.AiProviderRequest;
import com.awap.ai.application.LocalHeuristicAiBackend;
import com.awap.ai.domain.AiModelRouter;
import java.util.EnumSet;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Local deterministic provider; always available and free, so it is the last fallback. */
@Component
@ConditionalOnProperty(name = "awap.ai.enabled", havingValue = "true", matchIfMissing = true)
public class LocalHeuristicProvider implements AiProvider {

  private final LocalHeuristicAiBackend delegate;

  public LocalHeuristicProvider(LocalHeuristicAiBackend delegate) {
    this.delegate = delegate;
  }

  @Override
  public String id() {
    return "local";
  }

  @Override
  public List<AiModel> models() {
    return List.of(
        new AiModel(
            "local-heuristic",
            AiModelRouter.Tier.CHEAP,
            EnumSet.allOf(AiCapability.class),
            0L,
            250L));
  }

  @Override
  public boolean healthy() {
    return true;
  }

  @Override
  public String complete(AiProviderRequest request) {
    String content = delegate.complete(request.prompt(), request.maxTokens());
    if (content == null || content.isBlank()) {
      throw new AiProviderException(
          AiProviderException.Code.EMPTY_CONTENT,
          true,
          "The local heuristic provider returned an empty answer.");
    }
    return content;
  }
}

package com.awap.ai.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Deterministic local provider used when no external LLM is configured. It is intentionally
 * sandboxed: it has no tool access and only performs bounded text transforms, which makes the AI
 * node safe to exercise in dev and in tests without an external model.
 */
@Component
@ConditionalOnProperty(name = "awap.ai.enabled", havingValue = "true", matchIfMissing = true)
public class LocalHeuristicAiBackend implements AiBackendClient {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

  @Override
  public String complete(String prompt, int maxTokens) {
    String instruction = prompt.toLowerCase();
    if (instruction.startsWith("summarize:")) {
      String text = prompt.substring("summarize:".length()).trim();
      if (text.length() <= maxTokens * 4) {
        return text;
      }
      return text.substring(0, maxTokens * 4) + "...";
    }
    if (instruction.startsWith("classify:")) {
      String text = prompt.substring("classify:".length()).trim();
      if (text.contains("invoice") || text.contains("payment")) {
        return "FINANCE";
      }
      if (text.contains("contract") || text.contains("agreement")) {
        return "LEGAL";
      }
      return "GENERAL";
    }
    if (instruction.startsWith("extract:")) {
      return extract(prompt.substring("extract:".length()));
    }
    return "";
  }

  /** Deterministic offline extraction for invoices; the external provider returns real JSON. */
  private String extract(String payload) {
    int separator = payload.indexOf('\n');
    String document = separator < 0 ? payload : payload.substring(separator + 1);
    Map<String, Object> fields = new LinkedHashMap<>();
    putText(fields, "vendor", document, "vendor");
    putText(fields, "category", document, "category");
    putDate(fields, "dueDate", document);
    putAmount(fields, document);
    return OBJECT_MAPPER.valueToTree(fields).toString();
  }

  private static void putText(
      Map<String, Object> fields, String key, String document, String label) {
    Matcher matcher =
        Pattern.compile("(?i)\\b" + label + "\\s*[:=]\\s*([^\\n,;]+)").matcher(document);
    if (matcher.find()) {
      fields.put(key, matcher.group(1).trim());
    }
  }

  private static void putDate(Map<String, Object> fields, String key, String document) {
    Matcher matcher =
        Pattern.compile("(?i)\\bdue\\s*date\\s*[:=]\\s*(\\d{4}-\\d{2}-\\d{2})").matcher(document);
    if (matcher.find()) {
      fields.put(key, matcher.group(1));
    }
  }

  private static void putAmount(Map<String, Object> fields, String document) {
    Matcher matcher =
        Pattern.compile("(?i)\\bamount\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)").matcher(document);
    if (matcher.find()) {
      fields.put("amount", Double.parseDouble(matcher.group(1)));
    }
  }
}

package com.awap.common.knowledge;

import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** Masks obvious PII before text is embedded or indexed (issue #293). */
@Component
public class KnowledgePiiRedactor {

  private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+\\.[\\w.-]+");
  private static final Pattern PHONE = Pattern.compile("\\+?\\d[\\d ()-]{8,}\\d");

  public String redact(String text) {
    if (text == null || text.isEmpty()) {
      return "";
    }
    String withoutEmail = EMAIL.matcher(text).replaceAll("[email]");
    return PHONE.matcher(withoutEmail).replaceAll("[phone]");
  }

  public boolean containsPii(String text) {
    return text != null && (EMAIL.matcher(text).find() || PHONE.matcher(text).find());
  }
}

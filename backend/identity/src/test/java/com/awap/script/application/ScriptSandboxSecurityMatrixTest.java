package com.awap.script.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.awap.script.domain.ScriptSandboxException;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.Executors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Complete allowed/denied construct matrix for the deny-by-construction SCRIPT sandbox (issue
 * #298).
 *
 * <p>The test is intentionally explicit instead of reflective: adding an operator or function to
 * the parser without adding a row here is a review failure, and every denied row proves the
 * construct is rejected before it can produce a side effect.
 */
class ScriptSandboxSecurityMatrixTest {

  private final ScriptSandbox sandbox =
      new ScriptSandbox(1_000, 200, Executors.newVirtualThreadPerTaskExecutor(), 0);

  static Stream<Arguments> allowedConstructs() {
    Map<String, Object> context =
        Map.of("total", 21, "name", "ada", "age", 17, "empty", "", "nested", Map.of("x", 2));
    return Stream.of(
        Arguments.of("1 + 2 * 3", Map.of(), 7L),
        Arguments.of("(1 + 2) * 3", Map.of(), 9L),
        Arguments.of("10 - 4", Map.of(), 6L),
        Arguments.of("10 / 4", Map.of(), 2.5),
        Arguments.of("10 % 4", Map.of(), 2L),
        Arguments.of("-5 + 8", Map.of(), 3L),
        Arguments.of("'a' + 'b'", Map.of(), "ab"),
        Arguments.of("'a' + 1", Map.of(), "a1"),
        Arguments.of("1 == 1", Map.of(), true),
        Arguments.of("1 != 2", Map.of(), true),
        Arguments.of("1 < 2", Map.of(), true),
        Arguments.of("2 <= 2", Map.of(), true),
        Arguments.of("3 > 2", Map.of(), true),
        Arguments.of("3 >= 3", Map.of(), true),
        Arguments.of("true and not false", Map.of(), true),
        Arguments.of("false or true", Map.of(), true),
        Arguments.of("ctx.total * 2", context, 42L),
        Arguments.of("ctx.nested.x", context, 2),
        Arguments.of("ctx.missing", context, null),
        Arguments.of("len(ctx.name)", context, 3),
        Arguments.of("upper(ctx.name)", context, "ADA"),
        Arguments.of("lower('ADA')", Map.of(), "ada"),
        Arguments.of("abs(-7)", Map.of(), 7.0),
        Arguments.of("coalesce(ctx.missing, 'fallback')", context, "fallback"),
        Arguments.of("null == null", Map.of(), true));
  }

  @ParameterizedTest(name = "allows {0}")
  @MethodSource("allowedConstructs")
  void allowsExactlyTheDocumentedGrammar(
      String script, Map<String, Object> context, Object expected) {
    assertThat(sandbox.evaluate(script, context).value()).isEqualTo(expected);
  }

  static Stream<String> deniedConstructs() {
    return Stream.of(
        // Imports, classes, reflection, host runtime and process execution.
        "import java.io",
        "new java.io.File('/etc/passwd')",
        "java.lang.System",
        "Runtime.getRuntime()",
        "System.exit(0)",
        "Thread.sleep(1)",
        "Class.forName('java.lang.Runtime')",
        "ctx.name.getClass()",
        "ctx.name.toString()",
        "this",
        "super",
        "getClass()",
        // Environment, system properties and beans.
        "PATH",
        "env.SECRET",
        "process.env.SECRET",
        "System.getenv('PATH')",
        "spring.context",
        // Network primitives and SSRF-style payloads.
        "url('http://169.254.169.254/latest/meta-data')",
        "new URL('http://example.com')",
        "socket('example.com', 80)",
        "http.get('http://example.com')",
        "dns('example.com')",
        "file:///etc/passwd",
        // File and process access.
        "open('/etc/passwd')",
        "read('/etc/passwd')",
        "exec('rm -rf /')",
        "sh('id')",
        // Statements, collections and language features outside the grammar.
        "x = 1",
        "1; 2",
        "1, 2",
        "if (true) { 1 }",
        "for (i in ctx) { i }",
        "while (true) { }",
        "[1, 2, 3]",
        "{ 'a': 1 }",
        "ctx['name']",
        "ctx.name[0]",
        "lambda x: x",
        "function() { 1 }",
        // Comments and separators are not part of the grammar.
        "1 // comment",
        "1 # comment",
        "1 /* comment */",
        "` + '1' + `",
        // Unknown identifiers and functions.
        "unknown",
        "foo(1)",
        "len",
        // Obfuscation: zero-width and non-grammar unicode characters never widen the grammar.
        "Sys\u200btem.exit(0)",
        "co\u200bntext",
        "ctx.\u200bname",
        "\u00001",
        // Malformed expressions.
        "'unterminated",
        "(1 + 2",
        "1 +",
        "ctx.",
        "len(",
        "1 2",
        "1..2",
        "999999999999999999999999999999");
  }

  @ParameterizedTest(name = "denies {0}")
  @MethodSource("deniedConstructs")
  void rejectsEveryDeniedConstruct(String script) {
    assertThatThrownByScript(script);
  }

  @Test
  void fuzzInputsNeverEscapeTheParser() {
    Random random = new Random(20261116L);
    String alphabet =
        "abcxyz0123456789 ctx._+-*/%<>=!()'\"[],{}#;:&|\\\u200b\u0000ığüşöçİĞÜŞÖÇ"
            + "RuntimeSystemgetClassimportnewURLsockethttpfileexec";

    for (int iteration = 0; iteration < 2_000; iteration++) {
      int length = random.nextInt(80);
      StringBuilder script = new StringBuilder(length);
      for (int index = 0; index < length; index++) {
        script.append(alphabet.charAt(random.nextInt(alphabet.length())));
      }
      String candidate = script.toString();
      assertThatCode(
              () -> {
                try {
                  sandbox.evaluate(candidate, Map.of("name", "ada", "total", 21));
                } catch (ScriptSandboxException expected) {
                  // Rejection is the expected outcome for arbitrary input.
                }
              })
          .as(candidate)
          .doesNotThrowAnyException();
    }
  }

  @Test
  void deeplyNestedButBoundedExpressionsStillFollowTheGrammar() {
    String nested = "(".repeat(50) + "1 + 1" + ")".repeat(50);

    assertThat(sandbox.evaluate(nested, Map.of()).value()).isEqualTo(2L);
  }

  private void assertThatThrownByScript(String script) {
    assertThatCode(
            () -> {
              try {
                sandbox.evaluate(script, Map.of("name", "ada", "total", 21));
                throw new AssertionError("Script was accepted but must be denied: " + script);
              } catch (ScriptSandboxException expected) {
                assertThat(expected).isNotNull();
              }
            })
        .as(script)
        .doesNotThrowAnyException();
  }
}

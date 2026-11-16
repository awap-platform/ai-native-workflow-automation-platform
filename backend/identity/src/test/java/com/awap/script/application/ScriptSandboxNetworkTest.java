package com.awap.script.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.awap.script.domain.ScriptSandboxException;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.Executors;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Explicit network-access and sandbox-escape tests (issue #306). */
class ScriptSandboxNetworkTest {

  private final ScriptSandbox sandbox =
      new ScriptSandbox(1_000, 200, Executors.newVirtualThreadPerTaskExecutor(), 0);

  static Stream<String> networkPayloads() {
    return Stream.of(
        "url('http://169.254.169.254/latest/meta-data')",
        "new URL('https://example.com')",
        "http.get('https://example.com')",
        "HttpClient.newHttpClient()",
        "socket('example.com', 80)",
        "new Socket('example.com', 80)",
        "dns('example.com')",
        "InetAddress.getByName('example.com')",
        "file:///etc/passwd",
        "jdbc:postgresql://db:5432/awap",
        "ldap://127.0.0.1:389",
        "ctx.url.openConnection()",
        "curl('http://example.com')",
        "wget('http://example.com')");
  }

  @ParameterizedTest(name = "network payload is rejected: {0}")
  @MethodSource("networkPayloads")
  void rejectsNetworkAccessPayloads(String script) {
    assertThatThrownBy(() -> sandbox.evaluate(script, Map.of("url", "http://example.com")))
        .as(script)
        .isInstanceOf(ScriptSandboxException.class);
  }

  @Test
  void rejectsHostClassesMethodCallsImportsAndReflection() {
    for (String script :
        new String[] {
          "Runtime.getRuntime().exec('id')",
          "System.getenv('PATH')",
          "Class.forName('java.lang.Runtime')",
          "ctx.toString()",
          "ctx.getClass()",
          "this.getClass()",
          "import java.net.URL",
          "new java.io.File('/etc/passwd')"
        }) {
      assertThatThrownBy(() -> sandbox.evaluate(script, Map.of()))
          .as(script)
          .isInstanceOf(ScriptSandboxException.class);
    }
  }

  @Test
  void rejectsCallableAndProxyContextValuesBeforeTheParserRuns() {
    Supplier<String> callable = () -> "secret";
    Object proxy =
        Proxy.newProxyInstance(
            getClass().getClassLoader(),
            new Class<?>[] {Runnable.class},
            (instance, method, args) -> null);

    assertThatThrownBy(() -> sandbox.evaluate("ctx.fn", Map.of("fn", callable)))
        .isInstanceOf(ScriptSandboxException.class)
        .hasMessageContaining("not a JSON primitive");
    assertThatThrownBy(() -> sandbox.evaluate("ctx.proxy", Map.of("proxy", proxy)))
        .isInstanceOf(ScriptSandboxException.class)
        .hasMessageContaining("not a JSON primitive");
    assertThatThrownBy(
            () -> sandbox.evaluate("ctx.nested.fn", Map.of("nested", Map.of("fn", callable))))
        .isInstanceOf(ScriptSandboxException.class)
        .hasMessageContaining("nested.fn");
  }

  @Test
  void rejectsNonPrimitiveScriptResults() {
    assertThatThrownBy(() -> sandbox.evaluate("ctx", Map.of("name", "ada")))
        .isInstanceOf(ScriptSandboxException.class)
        .hasMessageContaining("JSON primitive");

    assertThat(sandbox.evaluate("ctx.name", Map.of("name", "ada")).value()).isEqualTo("ada");
    assertThat(sandbox.evaluate("ctx.total", Map.of("total", 21)).value()).isEqualTo(21);
  }

  @Test
  void allowedContextCollectionsRemainReadable() {
    Map<String, Object> context = Map.of("items", List.of("a", "b"), "nested", Map.of("x", 2));

    assertThat(sandbox.evaluate("ctx.nested.x", context).value()).isEqualTo(2);
    assertThat(sandbox.evaluate("len(ctx.items)", context).value()).isEqualTo(6);
  }

  @Test
  void networkFuzzInputsNeverEscapeTheParser() {
    Random random = new Random(20261116L);
    String alphabet = "abcURLHttpSocketDNSfile:/\\@#%&?=+0123456789 ctx._()'\"\u200b\u0000";
    for (int iteration = 0; iteration < 1_000; iteration++) {
      int length = random.nextInt(60);
      StringBuilder script = new StringBuilder();
      for (int index = 0; index < length; index++) {
        script.append(alphabet.charAt(random.nextInt(alphabet.length())));
      }
      String candidate = script.toString();
      assertThatCode(
              () -> {
                try {
                  sandbox.evaluate(candidate, Map.of("url", "http://example.com"));
                } catch (ScriptSandboxException expected) {
                  // Rejection is expected for arbitrary input.
                }
              })
          .as(candidate)
          .doesNotThrowAnyException();
    }
  }

  @Test
  void timeoutStillAppliesAfterTheNetworkDenylist() {
    ScriptSandbox slow =
        new ScriptSandbox(5, 200, Executors.newVirtualThreadPerTaskExecutor(), 250);

    assertThatThrownBy(() -> slow.evaluate("url('http://example.com')", Map.of()))
        .isInstanceOfSatisfying(
            ScriptSandboxException.class,
            ex -> {
              assertThat(ex.isTimeout()).isTrue();
              assertThat(ex.getMessage()).contains("timed out");
            });
  }
}

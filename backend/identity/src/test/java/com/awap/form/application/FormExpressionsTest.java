package com.awap.form.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Calculation grammar shared with the frontend: precedence, functions and null propagation. */
class FormExpressionsTest {

  private static final Map<String, String> VALUES =
      Map.of("units", "3", "price", "2.5", "empty", "");

  @Test
  void evaluatesArithmeticWithPrecedence() {
    assertThat(FormExpressions.evaluate("1 + 2 * 3", VALUES)).isEqualTo(7.0);
    assertThat(FormExpressions.evaluate("(1 + 2) * 3", VALUES)).isEqualTo(9.0);
    assertThat(FormExpressions.evaluate("-4 / 2", VALUES)).isEqualTo(-2.0);
  }

  @Test
  void evaluatesFunctionsAndFields() {
    assertThat(FormExpressions.evaluate("units * price", VALUES)).isEqualTo(7.5);
    assertThat(FormExpressions.evaluate("sum(units, price)", VALUES)).isEqualTo(5.5);
    assertThat(FormExpressions.evaluate("avg(units, price, 8)", VALUES)).isEqualTo(4.5);
    assertThat(FormExpressions.evaluate("max(units, price)", VALUES)).isEqualTo(3.0);
    assertThat(FormExpressions.evaluate("round(10 / 3, 2)", VALUES)).isEqualTo(3.33);
    assertThat(FormExpressions.evaluate("abs(0 - 7)", VALUES)).isEqualTo(7.0);
  }

  @Test
  void missingOrEmptyValuesMakeTheResultNotComputable() {
    assertThat(FormExpressions.evaluate("sum(units, empty)", VALUES)).isNull();
    assertThat(FormExpressions.evaluate("missing + 1", VALUES)).isNull();
    assertThat(FormExpressions.evaluate("units / 0", VALUES)).isNull();
  }

  @Test
  void supportsSingleArgumentFunctionsAndPrecision() {
    assertThat(FormExpressions.evaluate("round(2.6)", VALUES)).isEqualTo(3.0);
    assertThat(FormExpressions.evaluate("round(-2.6, 1)", VALUES)).isEqualTo(-2.6);
    assertThat(FormExpressions.evaluate("round(units, 99)", VALUES)).isEqualTo(3.0);
    assertThat(FormExpressions.evaluate("min(units, price, 1)", VALUES)).isEqualTo(1.0);
    assertThat(FormExpressions.evaluate("avg(units)", VALUES)).isEqualTo(3.0);
    assertThat(FormExpressions.evaluate("abs(-9)", VALUES)).isEqualTo(9.0);
    assertThat(FormExpressions.evaluate("sum()", VALUES)).isNull();
    assertThat(FormExpressions.evaluate("round(empty)", VALUES)).isNull();
  }

  @Test
  void rejectsEmptyAndUnbalancedInput() {
    assertThatThrownBy(() -> FormExpressions.compile(""))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
    assertThatThrownBy(() -> FormExpressions.compile("(1 + 2"))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
    assertThatThrownBy(() -> FormExpressions.compile("sum(1, 2"))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
    assertThatThrownBy(() -> FormExpressions.compile("1 ; 2"))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
  }

  @Test
  void treatsNonNumericFieldValuesAsNotComputable() {
    assertThat(FormExpressions.evaluate("units + units", Map.of("units", "abc"))).isNull();
    assertThat(FormExpressions.evaluate("units * 2", Map.of("units", "Infinity"))).isNull();
    assertThat(FormExpressions.evaluate("1 + 2", Map.of())).isEqualTo(3.0);
  }

  @Test
  void reportsDependenciesInFirstSeenOrder() {
    assertThat(FormExpressions.dependencies("a + b * a")).containsExactly("a", "b");
    assertThat(FormExpressions.dependencies("sum(x, 2)")).containsExactly("x");
    assertThat(FormExpressions.dependencies("1 + 2")).isEqualTo(List.of());
  }

  @Test
  void rejectsUnknownFunctionsAndMalformedInput() {
    assertThatThrownBy(() -> FormExpressions.compile("eval(1)"))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
    assertThatThrownBy(() -> FormExpressions.compile("1 +"))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
    assertThatThrownBy(() -> FormExpressions.compile("a[0]"))
        .isInstanceOf(FormExpressions.InvalidExpressionException.class);
  }
}

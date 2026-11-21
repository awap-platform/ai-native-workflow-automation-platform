package com.awap.form.application;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Small, side-effect-free calculation language used by calculated form fields.
 *
 * <p>The same grammar exists in {@code frontend/lib/forms/schema.ts}. Both evaluate to {@code null}
 * when a referenced value is missing or not numeric, so an incomplete form never produces a bogus
 * number. Only numbers, field ids, {@code + - * /}, parentheses and the functions
 * sum/avg/min/max/abs/round are accepted; there is no property access, no function definition and
 * no Java or JavaScript evaluation, which keeps a hostile schema inert.
 */
final class FormExpressions {

  private static final Set<String> FUNCTIONS = Set.of("sum", "avg", "min", "max", "abs", "round");

  private FormExpressions() {}

  /** Field ids the expression reads, in first-seen order. */
  static List<String> dependencies(String source) {
    return compile(source).dependencies;
  }

  /** Evaluates the expression; {@code null} means "not computable yet". */
  static Double evaluate(String source, Map<String, String> values) {
    return compile(source).evaluate(values);
  }

  static Compiled compile(String source) {
    Parser parser = new Parser(tokenize(source));
    Node root = parser.parseExpression();
    parser.expectEnd();
    return new Compiled(root, List.copyOf(parser.dependencies));
  }

  /** Thrown for any schema authoring or data error in an expression. */
  static final class InvalidExpressionException extends RuntimeException {
    InvalidExpressionException(String message) {
      super(message);
    }
  }

  /** A compiled expression and the fields it reads. */
  static final class Compiled {
    private final Node root;
    private final List<String> dependencies;

    private Compiled(Node root, List<String> dependencies) {
      this.root = root;
      this.dependencies = dependencies;
    }

    Double evaluate(Map<String, String> values) {
      return root.evaluate(values);
    }
  }

  private interface Node {
    Double evaluate(Map<String, String> values);
  }

  private static List<String> tokenize(String source) {
    List<String> tokens = new ArrayList<>();
    int index = 0;
    while (index < source.length()) {
      char current = source.charAt(index);
      if (Character.isWhitespace(current)) {
        index++;
        continue;
      }
      if (Character.isDigit(current) || current == '.') {
        int start = index;
        while (index < source.length()
            && (Character.isDigit(source.charAt(index)) || source.charAt(index) == '.')) {
          index++;
        }
        tokens.add(source.substring(start, index));
        continue;
      }
      if (Character.isLetter(current) || current == '_') {
        int start = index;
        while (index < source.length()
            && (Character.isLetterOrDigit(source.charAt(index)) || source.charAt(index) == '_')) {
          index++;
        }
        tokens.add(source.substring(start, index));
        continue;
      }
      if ("+-*/(),".indexOf(current) >= 0) {
        tokens.add(String.valueOf(current));
        index++;
        continue;
      }
      throw new InvalidExpressionException("Unexpected character '" + current + "'.");
    }
    return tokens;
  }

  private static final class Parser {
    private final List<String> tokens;
    private int position;
    private final Set<String> dependencies = new LinkedHashSet<>();

    Parser(List<String> tokens) {
      this.tokens = tokens;
    }

    String peek() {
      return position < tokens.size() ? tokens.get(position) : null;
    }

    String next() {
      if (position >= tokens.size()) {
        throw new InvalidExpressionException("Unexpected end of expression.");
      }
      return tokens.get(position++);
    }

    void expectEnd() {
      if (position != tokens.size()) {
        throw new InvalidExpressionException("Unexpected token '" + tokens.get(position) + "'.");
      }
    }

    private void expect(String expected) {
      String actual = next();
      if (!expected.equals(actual)) {
        throw new InvalidExpressionException(
            "Expected '" + expected + "' but found '" + actual + "'.");
      }
    }

    Node parseExpression() {
      Node left = parseTerm();
      while ("+".equals(peek()) || "-".equals(peek())) {
        String operator = next();
        Node right = parseTerm();
        Node previous = left;
        left =
            values -> {
              Double a = previous.evaluate(values);
              Double b = right.evaluate(values);
              if (a == null || b == null) {
                return null;
              }
              return "+".equals(operator) ? a + b : a - b;
            };
      }
      return left;
    }

    private Node parseTerm() {
      Node left = parseUnary();
      while ("*".equals(peek()) || "/".equals(peek())) {
        String operator = next();
        Node right = parseUnary();
        Node previous = left;
        left =
            values -> {
              Double a = previous.evaluate(values);
              Double b = right.evaluate(values);
              if (a == null || b == null || ("/".equals(operator) && b == 0.0)) {
                return null;
              }
              return "*".equals(operator) ? a * b : a / b;
            };
      }
      return left;
    }

    private Node parseUnary() {
      if ("-".equals(peek())) {
        next();
        Node operand = parseUnary();
        return values -> {
          Double value = operand.evaluate(values);
          return value == null ? null : -value;
        };
      }
      return parsePrimary();
    }

    private Node parsePrimary() {
      String token = peek();
      if (token == null) {
        throw new InvalidExpressionException("Unexpected end of expression.");
      }
      if (token.equals("(")) {
        next();
        Node inner = parseExpression();
        expect(")");
        return inner;
      }
      if (Character.isDigit(token.charAt(0)) || token.charAt(0) == '.') {
        next();
        double constant;
        try {
          constant = Double.parseDouble(token);
        } catch (NumberFormatException ex) {
          throw new InvalidExpressionException("Invalid number '" + token + "'.");
        }
        return values -> constant;
      }
      if (Character.isLetter(token.charAt(0)) || token.charAt(0) == '_') {
        next();
        if ("(".equals(peek())) {
          if (!FUNCTIONS.contains(token)) {
            throw new InvalidExpressionException("Unknown function '" + token + "'.");
          }
          next();
          List<Node> arguments = new ArrayList<>();
          if (!")".equals(peek())) {
            arguments.add(parseExpression());
            while (",".equals(peek())) {
              next();
              arguments.add(parseExpression());
            }
          }
          expect(")");
          List<Node> args = List.copyOf(arguments);
          String name = token;
          return values -> call(name, args, values);
        }
        dependencies.add(token);
        return values -> number(values.get(token));
      }
      throw new InvalidExpressionException("Unexpected token '" + token + "'.");
    }
  }

  private static Double call(String name, List<Node> arguments, Map<String, String> values) {
    if (arguments.isEmpty()) {
      return null;
    }
    List<Double> evaluated = new ArrayList<>(arguments.size());
    for (Node argument : arguments) {
      evaluated.add(argument.evaluate(values));
    }
    if ("round".equals(name)) {
      Double first = evaluated.get(0);
      if (first == null) {
        return null;
      }
      int digits = 0;
      if (evaluated.size() > 1 && evaluated.get(1) != null) {
        digits = (int) Math.floor(evaluated.get(1));
      }
      digits = Math.max(0, Math.min(6, digits));
      double factor = Math.pow(10, digits);
      return Math.round(first * factor) / factor;
    }
    for (Double value : evaluated) {
      if (value == null) {
        return null;
      }
    }
    // `round` was handled above and the parser only accepts known names, so `default` is `abs`.
    return switch (name) {
      case "sum" -> evaluated.stream().mapToDouble(Double::doubleValue).sum();
      case "avg" -> evaluated.stream().mapToDouble(Double::doubleValue).average().orElse(0);
      case "min" -> evaluated.stream().mapToDouble(Double::doubleValue).min().orElse(0);
      case "max" -> evaluated.stream().mapToDouble(Double::doubleValue).max().orElse(0);
      default -> Math.abs(evaluated.get(0));
    };
  }

  private static Double number(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    try {
      double parsed = Double.parseDouble(raw.trim());
      return Double.isFinite(parsed) ? parsed : null;
    } catch (NumberFormatException ex) {
      return null;
    }
  }
}

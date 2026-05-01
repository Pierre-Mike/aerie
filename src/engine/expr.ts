// Tiny expression evaluator for policy rules. Parses with jsep, walks the AST.
// Supported: literals, member access (a.b.c), == != < <= > >=, && || !, parens.
// Anything else throws — by design, policy rules should be boring.

import jsep from "jsep";

export type EvalScope = Record<string, unknown>;

const ALLOWED_BINARY = new Set(["==", "===", "!=", "!==", "<", "<=", ">", ">=", "&&", "||"]);
const ALLOWED_LOGICAL = new Set(["&&", "||"]);
const ALLOWED_UNARY = new Set(["!"]);

export function compile(rule: string): (scope: EvalScope) => unknown {
  const ast = jsep(rule);
  return (scope) => evalNode(ast, scope);
}

function evalNode(node: jsep.Expression, scope: EvalScope): unknown {
  switch (node.type) {
    case "Literal":
      return (node as jsep.Literal).value;
    case "Identifier":
      return scope[(node as jsep.Identifier).name];
    case "MemberExpression": {
      const m = node as jsep.MemberExpression;
      const obj = evalNode(m.object, scope);
      if (obj == null) return undefined;
      const key = m.computed
        ? (evalNode(m.property, scope) as string | number)
        : (m.property as jsep.Identifier).name;
      return (obj as Record<string | number, unknown>)[key];
    }
    case "BinaryExpression": {
      const b = node as jsep.BinaryExpression;
      if (!ALLOWED_BINARY.has(b.operator)) {
        throw new Error(`disallowed operator: ${b.operator}`);
      }
      // Short-circuit for logical ops — don't evaluate right side if left decides.
      if (b.operator === "&&") {
        const l = evalNode(b.left, scope);
        return l ? evalNode(b.right, scope) : l;
      }
      if (b.operator === "||") {
        const l = evalNode(b.left, scope);
        return l ? l : evalNode(b.right, scope);
      }
      const l = evalNode(b.left, scope);
      const r = evalNode(b.right, scope);
      switch (b.operator) {
        case "==":
        case "===": return l === r;
        case "!=":
        case "!==": return l !== r;
        case "<":  return (l as number) <  (r as number);
        case "<=": return (l as number) <= (r as number);
        case ">":  return (l as number) >  (r as number);
        case ">=": return (l as number) >= (r as number);
        default: throw new Error(`unreachable: ${b.operator}`);
      }
    }
    case "LogicalExpression": {
      const l = node as unknown as {
        operator: string;
        left: jsep.Expression;
        right: jsep.Expression;
      };
      if (!ALLOWED_LOGICAL.has(l.operator)) {
        throw new Error(`disallowed logical op: ${l.operator}`);
      }
      const left = evalNode(l.left, scope);
      if (l.operator === "&&") return left ? evalNode(l.right, scope) : left;
      return left ? left : evalNode(l.right, scope);
    }
    case "UnaryExpression": {
      const u = node as jsep.UnaryExpression;
      if (!ALLOWED_UNARY.has(u.operator)) {
        throw new Error(`disallowed unary op: ${u.operator}`);
      }
      return !evalNode(u.argument, scope);
    }
    case "ArrayExpression": {
      const a = node as unknown as { elements: jsep.Expression[] };
      return a.elements.map((e) => evalNode(e, scope));
    }
    default:
      throw new Error(`unsupported expression node: ${node.type}`);
  }
}

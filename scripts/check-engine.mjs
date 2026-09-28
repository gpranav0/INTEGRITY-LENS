import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const banned = new Set([
  "sort",
  "toSorted",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "includes",
  "indexOf",
  "lastIndexOf",
  "flat",
  "flatMap",
  "forEach",
  "split",
  "match",
  "matchAll",
  "search",
  "replace",
  "replaceAll",
  "startsWith",
  "endsWith",
  "slice",
  "splice",
  "substring",
  "substr",
  "toLowerCase",
  "toUpperCase",
  "reverse",
  "concat",
  "join",
]);
const globals = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "window",
  "document",
  "fetch",
  "localStorage",
  "indexedDB",
  "process",
  "Deno",
]);
let errors = 0;
for (const file of readdirSync("packages/engine/src")) {
  if (!file.endsWith(".ts")) continue;
  const path = join("packages/engine/src", file),
    source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
  const fail = (node, message) => {
    const pos = source.getLineAndCharacterOfPosition(node.pos);
    console.error(`${path}:${pos.line + 1} ${message}`);
    errors++;
  };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral)
      fail(node, "Regular expressions are forbidden.");
    if (ts.isIdentifier(node) && globals.has(node.text))
      fail(node, "Forbidden global: " + node.text);
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (ts.isPropertyAccessExpression(c) && banned.has(c.name.text))
        fail(node, "Forbidden shortcut: " + c.name.text);
      if (
        ts.isElementAccessExpression(c) &&
        ts.isStringLiteral(c.argumentExpression) &&
        banned.has(c.argumentExpression.text)
      )
        fail(node, "Forbidden computed shortcut.");
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !(
        node.moduleSpecifier.text.startsWith(".") ||
        node.moduleSpecifier.text === "@integrity/shared"
      )
    )
      fail(node, "Engine imports must stay pure.");
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (errors) process.exitCode = 1;
else
  console.log(
    "Engine restrictions passed: no forbidden shortcuts, regex, built-in Map/Set, or environment dependencies.",
  );

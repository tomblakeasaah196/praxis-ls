/**
 * Tests for the no-native-dialogs rule.
 *
 * A lint rule is the one kind of code whose FALSE NEGATIVES are invisible: it
 * reports nothing, the build is green, and the thing it was written to prevent
 * ships anyway. That is not hypothetical here — the first draft of this rule
 * passed the whole tree and looked correct, while silently missing every bare
 * `alert(…)` and `confirm(…)` in it. The cause is the case pinned below as
 * "bare alert": globals declared through `languageOptions.globals` appear in
 * ESLint's scope `variables` exactly like source declarations, so the
 * "is this locally shadowed?" guard treated every global call as shadowed. Only
 * `defs.length` separates the two.
 *
 * So the negative cases here are not padding. Each is a shape that exists in
 * this codebase and MUST keep linting clean, and each is a way the rule could
 * be "fixed" into uselessness:
 *
 *   operations/place-picker.tsx  `async function confirm(...)`  — a real local
 *   finance/statements.tsx       `async function confirm()`     — another
 *   ui/dialog.tsx                `onConfirm` / `<ConfirmDialog>` — JSX props
 *
 * Run with:  node --test eslint-local-rules/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { RuleTester } = require("eslint");
const parser = require("@typescript-eslint/parser");
const rule = require("./no-native-dialogs.cjs");

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: {
      alert: "readonly",
      confirm: "readonly",
      prompt: "readonly",
      window: "readonly",
      globalThis: "readonly",
      self: "readonly",
    },
  },
});

test("no-native-dialogs", () => {
  ruleTester.run("no-native-dialogs", rule, {
    valid: [
      // A locally declared function that happens to be called `confirm`.
      // Both of these shapes are live in the tree today.
      { code: `async function confirm(a) { return a; }\nconfirm(1);` },
      { code: `const confirm = () => {};\nconfirm();` },
      // A method on something that is not the global object.
      { code: `api.confirm({ id: 1 });` },
      { code: `stage.suggestion.confirm();` },
      // An import that shadows the global name.
      { code: `import { confirm } from "./x";\nconfirm();` },
      // A parameter.
      { code: `function f(confirm) { confirm(); }` },
      // The design-system replacements must never trip the rule.
      { code: `const x = <ConfirmDialog onConfirm={() => {}} />;` },
      { code: `const x = <Dialog onClose={close} title="Discard draft?" />;` },
      // A property access that is not a call.
      { code: `const fn = window.confirm;` },
    ],

    invalid: [
      // ── the bare globals: the class the first draft missed entirely ──
      {
        code: `alert("saved");`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `if (confirm("sure?")) { go(); }`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `const why = prompt("Reason?");`,
        errors: [{ messageId: "banned" }],
      },
      // ── the explicit member forms ──
      { code: `window.confirm("x");`, errors: [{ messageId: "banned" }] },
      { code: `window.alert(msg);`, errors: [{ messageId: "banned" }] },
      { code: `window.prompt("Link to:");`, errors: [{ messageId: "banned" }] },
      { code: `globalThis.alert("x");`, errors: [{ messageId: "banned" }] },
      { code: `self.confirm("x");`, errors: [{ messageId: "banned" }] },
      // Inside a catch, which is where alert() usually hides.
      {
        code: `try { go(); } catch (e) { alert(String(e)); }`,
        errors: [{ messageId: "banned" }],
      },
      // Negated, the most common confirm shape in this codebase.
      {
        code: `if (!window.confirm("Archive?")) return;`,
        errors: [{ messageId: "banned" }],
      },
      // Two on one line still report twice.
      {
        code: `const a = prompt("a"); const b = prompt("b");`,
        errors: [{ messageId: "banned" }, { messageId: "banned" }],
      },
    ],
  });

  assert.ok(true, "RuleTester assertions all passed");
});

test("the message names a concrete replacement per dialog kind", () => {
  const { Linter } = require("eslint");
  const linter = new Linter({ configType: "flat" });
  const config = [
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { alert: "readonly", confirm: "readonly", prompt: "readonly" },
      },
      plugins: { praxis: { rules: { "no-native-dialogs": rule } } },
      rules: { "praxis/no-native-dialogs": "error" },
    },
  ];
  const msg = (code) =>
    linter.verify(code, config, "t.tsx").find((m) => m.ruleId)?.message ?? "";

  // The remedy has to be in the message. A rule that says "don't" without
  // saying "do this instead" gets disabled rather than obeyed.
  assert.match(msg(`confirm("x");`), /ConfirmDialog/);
  assert.match(msg(`alert("x");`), /Callout|Toast/);
  assert.match(msg(`prompt("x");`), /Dialog.*Field|Field.*Input/);
});

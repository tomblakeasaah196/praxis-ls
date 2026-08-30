/**
 * no-native-dialogs — `window.confirm`, `window.alert` and `window.prompt` are
 * not part of this product's design system, and nothing may reintroduce them.
 *
 * WHY THIS IS A GATE AND NOT A CONVENTION. A native dialog is the one piece of
 * UI a tenant sees that is drawn by the BROWSER rather than by us:
 *
 *   - It renders in OS chrome, titled "app.praxis-ls.com says". Whatever the
 *     tenant's white-label settings are, this ignores them.
 *   - It has no type scale, spacing, shadow or colour from index.css, so a
 *     WARNING cannot be red and a destructive action cannot look destructive.
 *   - Its buttons are "OK" and "Cancel". They never name the action, which is
 *     precisely the property doc/UX_WRITING.md requires of a confirmation.
 *   - `alert` and `confirm` BLOCK THE EVENT LOOP. Timers, autosave flushes and
 *     in-flight fetches stall until a human clicks, which has produced real
 *     defects here (a draft autosave landing after a discard).
 *   - None of them can be translated by `tr()`, and none are reachable by the
 *     focus-management and live-region work the a11y audit paid for.
 *
 * The audit found 33 of these across the client and the platform console. They
 * were not written by careless people — each was a reasonable local choice made
 * because reaching for a modal was more work than reaching for `confirm`. That
 * asymmetry is what a lint rule removes.
 *
 * WHAT TO USE INSTEAD:
 *
 *   window.confirm  →  <ConfirmDialog destructive dismissible={false} …>
 *                      (components/ui/dialog.tsx). Name the object in `body`
 *                      and the action in `confirmLabel`.
 *   window.prompt   →  a <Dialog> with a real <Field> + <Input>. A prompt has
 *                      no label, no validation, no hint and no i18n.
 *   window.alert    →  <Callout> for an outcome the user is reading now, or
 *                      <Toast> for one they do not need to read to continue.
 *                      An alert for an error is almost always a Callout.
 *
 * ESCAPE HATCH, deliberately narrow. `eslint-disable-next-line
 * praxis/no-native-dialogs` still works and requires a written reason next to
 * it, the same shape every other exception in this config uses. There is
 * exactly one defensible case in the tree — `window.print()` adjacent flows and
 * `beforeunload`, neither of which this rule matches anyway.
 *
 * DETECTION. Matches the bare globals (`confirm(…)`) and the explicit member
 * forms (`window.confirm(…)`, `globalThis.alert(…)`, `self.prompt(…)`). It does
 * NOT match a method on any other object, so `api.confirm()`, `stage.confirm()`
 * and a locally-declared `function confirm()` are all left alone — that
 * false-positive class is what would otherwise teach people to disable the rule.
 */
"use strict";

const BANNED = new Set(["confirm", "alert", "prompt"]);
const HOSTS = new Set(["window", "globalThis", "self"]);

/**
 * True when `name` resolves to a binding the SOURCE declares — an import, a
 * function declaration, a const — rather than to the browser global.
 *
 * The `defs.length > 0` test is the whole subtlety, and getting it wrong is how
 * the first draft of this rule silently passed every bare `alert(…)` in the
 * tree. Globals configured through `languageOptions.globals` are present in the
 * global scope's `variables` list exactly like real declarations; what
 * distinguishes them is that they have no definition SITE. So "is there a
 * variable with this name" is always true and answers nothing — "was it
 * declared by code we are looking at" is the actual question.
 */
function isLocallyBound(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.variables.find((x) => x.name === name);
    if (v) return v.defs.length > 0;
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Native browser dialogs (confirm/alert/prompt) are banned — use ConfirmDialog, Dialog or Callout so the popup is branded.",
    },
    schema: [],
    messages: {
      banned:
        "`{{name}}` renders a BROWSER dialog, not a Praxis one — no brand, no warning colour, buttons that say “OK”, and it blocks the event loop. Use {{fix}}. If this is genuinely the exception, add `eslint-disable-next-line praxis/no-native-dialogs` with a written reason.",
    },
  },

  create(context) {
    const source = context.sourceCode || context.getSourceCode();

    const REMEDY = {
      confirm:
        "<ConfirmDialog destructive dismissible={false}> from components/ui/dialog",
      alert: "<Callout> for a result the user is reading, or <Toast>",
      prompt: "a <Dialog> with a labelled <Field> + <Input>",
    };

    function report(node, name) {
      context.report({
        node,
        messageId: "banned",
        data: { name, fix: REMEDY[name] },
      });
    }

    return {
      CallExpression(node) {
        const callee = node.callee;

        // window.confirm(…) / globalThis.alert(…) / self.prompt(…)
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          HOSTS.has(callee.object.name) &&
          callee.property.type === "Identifier" &&
          BANNED.has(callee.property.name)
        ) {
          report(node, callee.property.name);
          return;
        }

        // Bare `confirm(…)` — but only when it resolves to the global. A
        // module-scoped `async function confirm()` (operations/place-picker,
        // finance/statements) is a different function that happens to share a
        // name, and flagging it would be the false positive that kills the rule.
        if (callee.type === "Identifier" && BANNED.has(callee.name)) {
          const scope = source.getScope
            ? source.getScope(node)
            : context.getScope();
          if (isLocallyBound(scope, callee.name)) return;
          report(node, callee.name);
        }
      },
    };
  },
};

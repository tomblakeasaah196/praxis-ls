"use strict";
/**
 * The Zod 3 wording kept on Zod 4 (packages/shared/zod-messages.js).
 *
 * These strings reach people: the API returns them as `error.fields`, forms print them under the
 * field and the assistant reads them back. A Zod upgrade that rewords them is a product change, so
 * each sentence the layer promises is pinned here, along with the rule that a message a schema
 * sets itself is never overwritten.
 */
const { z } = require("zod");
require("../../packages/shared/zod-messages");

const first = (schema, input) => {
  const r = schema.safeParse(input);
  expect(r.success).toBe(false);
  return r.error.issues[0].message;
};

describe("Zod 3 default wording on Zod 4", () => {
  test("a missing field is 'Required', a wrong type names both types", () => {
    expect(first(z.object({ a: z.string() }), {})).toBe("Required");
    expect(first(z.string(), 5)).toBe("Expected string, received number");
    expect(first(z.number(), "x")).toBe("Expected number, received string");
    expect(first(z.string(), null)).toBe("Expected string, received null");
    expect(first(z.array(z.string()), {})).toBe("Expected array, received object");
    expect(first(z.number(), NaN)).toBe("Expected number, received nan");
  });

  test("string, number and array bounds", () => {
    expect(first(z.string().min(3), "ab")).toBe("String must contain at least 3 character(s)");
    expect(first(z.string().max(2), "abc")).toBe("String must contain at most 2 character(s)");
    expect(first(z.string().length(4), "abc")).toBe("String must contain exactly 4 character(s)");
    expect(first(z.number().min(5), 4)).toBe("Number must be greater than or equal to 5");
    expect(first(z.number().max(5), 6)).toBe("Number must be less than or equal to 5");
    expect(first(z.number().positive(), 0)).toBe("Number must be greater than 0");
    expect(first(z.number().int(), 1.5)).toBe("Expected integer, received float");
    expect(first(z.number().multipleOf(5), 7)).toBe("Number must be a multiple of 5");
    expect(first(z.array(z.string()).min(1), [])).toBe("Array must contain at least 1 element(s)");
    expect(first(z.array(z.string()).max(1), ["a", "b"])).toBe("Array must contain at most 1 element(s)");
  });

  test("enums, literals, unions, formats", () => {
    expect(first(z.enum(["a", "b"]), "c")).toBe("Invalid enum value. Expected 'a' | 'b', received 'c'");
    expect(first(z.literal("x"), "y")).toBe('Invalid literal value, expected "x"');
    expect(first(z.union([z.string(), z.number()]), true)).toBe("Invalid input");
    expect(first(z.string().email(), "nope")).toBe("Invalid email");
    expect(first(z.string().guid(), "nope")).toBe("Invalid uuid");
    expect(first(z.string().url(), "nope")).toBe("Invalid url");
    expect(first(z.string().datetime(), "nope")).toBe("Invalid datetime");
    expect(first(z.string().regex(/^a/), "b")).toBe("Invalid");
    expect(first(z.string().startsWith("a"), "b")).toBe('Invalid input: must start with "a"');
  });

  test("strict objects name the extra keys, a bare refine says 'Invalid input'", () => {
    expect(first(z.object({ a: z.string() }).strict(), { a: "x", b: 1, c: 2 })).toBe("Unrecognized key(s) in object: 'b', 'c'");
    expect(first(z.string().refine(() => false), "x")).toBe("Invalid input");
  });

  test("a message the schema sets itself is never replaced", () => {
    expect(first(z.string().min(3, "Too short."), "ab")).toBe("Too short.");
    expect(first(z.string({ error: "Name needed." }), undefined)).toBe("Name needed.");
    expect(first(z.string().refine(() => false, "Nope."), "x")).toBe("Nope.");
    expect(first(z.string().refine(() => false, { error: (iss) => `"${iss.input}" is wrong` }), "x")).toBe('"x" is wrong');
  });

  test("the shared requiredString keeps its own label", () => {
    const { common } = require("../../packages/shared");
    expect(first(common.requiredText("Client name"), undefined)).toBe("Client name is required.");
    expect(first(common.requiredText("Client name"), "")).toBe("Client name is required.");
  });
});

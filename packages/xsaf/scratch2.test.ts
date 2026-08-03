import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";

test("throws", () => {
  expect(() => {
    throw new ORPCError("UNAUTHORIZED");
  }).toThrow("Unauthorized");
});

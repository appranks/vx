import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../tests/helpers/mock-context.ts";
import { runInit } from "./init.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runInit", () => {
	it("errors on unknown preset", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, ["nonexistent"]);
		await expect(runInit(ctx)).rejects.toThrow("exit");
		expect(ctx.errors[0]).toContain("unknown preset");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

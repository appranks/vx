import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../../tests/helpers/mock-context.ts";
import { runDown } from "../down.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runDown", () => {
	it("reports not_running when compose file does not exist", async () => {
		(globalThis as Record<string, unknown>).Bun = {
			file: () => ({
				exists: () => Promise.resolve(false),
			}),
		};

		const ctx = buildMockContext();
		await runDown(ctx);
		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as { status: string };
		expect(output.status).toBe("not_running");

		delete (globalThis as Record<string, unknown>).Bun;
	});
});

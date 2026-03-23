import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../../tests/helpers/mock-context.ts";
import { runTraces } from "../traces.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runTraces", () => {
	it("errors when query argument is missing", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, []);
		await expect(runTraces(ctx)).rejects.toThrow("exit");
		expect(ctx.errors[0]).toBe("missing query argument");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("returns formatted trace entries on success", async () => {
		const ndjson = [
			JSON.stringify({
				traceID: "abc",
				spanID: "s1",
				operationName: "GET /",
				duration: 42,
				_time: "2026-01-01T00:00:00Z",
			}),
			"",
		].join("\n");
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response(ndjson, { status: 200 }));

		const ctx = buildMockContext({}, ["*"]);
		await runTraces(ctx);
		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as { count: number };
		expect(output.count).toBe(1);
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../../tests/helpers/mock-context.ts";
import { runMetrics } from "../metrics.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runMetrics", () => {
	it("errors when query argument is missing", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, []);
		await expect(runMetrics(ctx)).rejects.toThrow("exit");
		expect(ctx.errors[0]).toBe("missing query argument");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("returns formatted query results on success", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					status: "success",
					data: {
						resultType: "vector",
						result: [{ metric: { job: "api" }, value: [1711234567, "0.5"] }],
					},
				}),
				{ status: 200 },
			),
		);

		const ctx = buildMockContext({}, ["rate(http_requests_total[5m])"]);
		await runMetrics(ctx);
		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as {
			query: string;
			count: number;
			results: unknown[];
		};
		expect(output.query).toBe("rate(http_requests_total[5m])");
		expect(output.count).toBe(1);
	});

	it("exits with STACK_ERROR when victoria is unreachable", async () => {
		global.fetch = (vi.fn() as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, ["up"]);
		await expect(runMetrics(ctx)).rejects.toThrow("exit");
		expect(exitSpy).toHaveBeenCalledWith(2);
	});
});

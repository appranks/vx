import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../tests/helpers/mock-context.ts";
import { runCheck } from "./check.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runCheck", () => {
	it("errors when gate argument is missing", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, []);
		await expect(runCheck(ctx)).rejects.toThrow("exit");
		expect(ctx.errors[0]).toBe("missing gate argument");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("health gate fails when stack is not running", async () => {
		global.fetch = (vi.fn() as any).mockRejectedValue(new Error("ECONNREFUSED"));
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, ["health"]);
		await expect(runCheck(ctx)).rejects.toThrow("exit");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("health gate passes when stack is running", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValue(new Response("ok", { status: 200 }));
		const ctx = buildMockContext({}, ["health"]);
		await runCheck(ctx);
		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as { gate: string; status: string };
		expect(output.gate).toBe("health");
		expect(output.status).toBe("passed");
	});

	it("errors on unknown gate", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const ctx = buildMockContext({}, ["unknown-gate"]);
		await expect(runCheck(ctx)).rejects.toThrow("exit");
		expect(ctx.errors[0]).toContain("unknown gate");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

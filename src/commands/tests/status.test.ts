import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../../tests/helpers/mock-context.ts";
import { runStatus } from "../status.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runStatus", () => {
	it("reports all services as unreachable when fetch throws", async () => {
		global.fetch = (vi.fn() as any).mockRejectedValue(new Error("ECONNREFUSED"));
		const ctx = buildMockContext();
		await runStatus(ctx);
		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as { services: Array<{ status: string }> };
		expect(output.services).toHaveLength(4);
		for (const svc of output.services) {
			expect(svc.status).toBe("unreachable");
		}
	});

	it("reports healthy when all services respond ok", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValue(new Response("ok", { status: 200 }));
		const ctx = buildMockContext();
		await runStatus(ctx);
		const output = ctx.printed[0] as { services: Array<{ status: string }> };
		for (const svc of output.services) {
			expect(svc.status).toBe("healthy");
		}
	});
});

import { describe, expect, it } from "vitest";
import { buildMockContext } from "../../tests/helpers/mock-context.ts";
import { runSnippet } from "./snippet.ts";

describe("runSnippet", () => {
	it("prints snippet containing vx commands", async () => {
		const ctx = buildMockContext();
		await runSnippet(ctx);
		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as { snippet: string };
		expect(output.snippet).toContain("vx up");
		expect(output.snippet).toContain("vx down");
		expect(output.snippet).toContain("vx metrics");
	});
});

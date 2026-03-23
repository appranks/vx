import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../../tests/helpers/mock-context.ts";
import { runInit } from "../init.ts";

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
	(globalThis as any).Bun = {
		file: vi.fn().mockReturnValue({
			exists: () => Promise.resolve(false),
		}),
		write: vi.fn().mockResolvedValue(0),
	};
});

afterEach(() => {
	vi.restoreAllMocks();
	delete (globalThis as any).Bun;
});

describe("runInit", () => {
	it("outputs skill files and CLAUDE.md in result", async () => {
		const ctx = buildMockContext({}, []);
		await runInit(ctx);

		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as {
			files: Array<{ path: string; action: string }>;
			skills: string[];
			next_steps: string[];
		};

		expect(output.files).toHaveLength(3);
		expect(output.files[0].path).toBe(".claude/skills/vx-setup/SKILL.md");
		expect(output.files[0].action).toBe("created");
		expect(output.files[1].path).toBe(".claude/skills/vx-verify/SKILL.md");
		expect(output.files[1].action).toBe("created");
		expect(output.files[2].path).toBe("CLAUDE.md");
		expect(output.files[2].action).toBe("created");
		expect(output.skills).toEqual(["vx-setup", "vx-verify"]);
		expect(output.next_steps).toHaveLength(2);
	});

	it("reports skipped when files already exist", async () => {
		(globalThis as any).Bun = {
			file: vi.fn().mockReturnValue({
				exists: () => Promise.resolve(true),
				text: () => Promise.resolve("## vx\nexisting content"),
			}),
			write: vi.fn().mockResolvedValue(0),
		};

		const ctx = buildMockContext({}, []);
		await runInit(ctx);

		const output = ctx.printed[0] as { files: Array<{ path: string; action: string }> };
		for (const file of output.files) {
			expect(file.action).toBe("skipped");
		}
	});
});

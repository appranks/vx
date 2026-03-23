import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockContext } from "../../../tests/helpers/mock-context.ts";
import { runInit } from "../init.ts";

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock content.ts to avoid import.meta.dir (Bun-only API)
vi.mock("../../skills/content.ts", () => ({
	VX_SKILL: "# mock skill",
	VX_REFERENCES: {
		"bun.md": "# bun",
		"diagnostics.md": "# diagnostics",
		"env-vars.md": "# env-vars",
		"log-bridges.md": "# log-bridges",
		"manual-spans.md": "# manual-spans",
		"nextjs.md": "# nextjs",
		"node.md": "# node",
		"signals.md": "# signals",
	},
	CLAUDE_MD_BLOCK: "## vx mock",
}));

// Mock preset-writer instead of globalThis.Bun (Bun is read-only)
vi.mock("../../lib/preset-writer.ts", () => ({
	writeIfNotExists: vi.fn().mockResolvedValue("created"),
	appendClaudeMd: vi.fn().mockResolvedValue("created"),
}));

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runInit", () => {
	it("outputs skill files, references, and CLAUDE.md in result", async () => {
		const ctx = buildMockContext({}, []);
		await runInit(ctx);

		expect(ctx.printed).toHaveLength(1);
		const output = ctx.printed[0] as {
			files: Array<{ path: string; action: string }>;
			skills: string[];
			next_steps: string[];
		};

		// SKILL.md + 8 references + CLAUDE.md = 10 files
		expect(output.files.length).toBeGreaterThanOrEqual(10);
		expect(output.files[0].path).toBe(".claude/skills/vx/SKILL.md");
		expect(output.files[0].action).toBe("created");

		// Verify references are included
		const refPaths = output.files.filter((f) => f.path.startsWith(".claude/skills/vx/references/")).map((f) => f.path);
		expect(refPaths).toContain(".claude/skills/vx/references/signals.md");
		expect(refPaths).toContain(".claude/skills/vx/references/node.md");
		expect(refPaths).toContain(".claude/skills/vx/references/nextjs.md");
		expect(refPaths).toContain(".claude/skills/vx/references/bun.md");
		expect(refPaths).toContain(".claude/skills/vx/references/log-bridges.md");
		expect(refPaths).toContain(".claude/skills/vx/references/manual-spans.md");
		expect(refPaths).toContain(".claude/skills/vx/references/diagnostics.md");
		expect(refPaths).toContain(".claude/skills/vx/references/env-vars.md");

		// CLAUDE.md is last
		const lastFile = output.files[output.files.length - 1];
		expect(lastFile.path).toBe("CLAUDE.md");
		expect(lastFile.action).toBe("created");

		// Single unified skill
		expect(output.skills).toEqual(["vx"]);
		expect(output.next_steps).toHaveLength(1);
	});

	it("reports skipped when files already exist", async () => {
		const presetWriter = await import("../../lib/preset-writer.ts");
		(presetWriter.writeIfNotExists as ReturnType<typeof vi.fn>).mockResolvedValue("skipped");
		(presetWriter.appendClaudeMd as ReturnType<typeof vi.fn>).mockResolvedValue("skipped");

		const ctx = buildMockContext({}, []);
		await runInit(ctx);

		const output = ctx.printed[0] as { files: Array<{ path: string; action: string }> };
		for (const file of output.files) {
			expect(file.action).toBe("skipped");
		}
	});
});

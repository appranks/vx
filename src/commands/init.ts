import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { appendClaudeMd, writeIfNotExists } from "../lib/preset-writer.ts";
import { c, icon, st } from "../lib/style.ts";
import { CLAUDE_MD_BLOCK, VX_REFERENCES, VX_SKILL } from "../skills/content.ts";

interface FileResult {
	path: string;
	action: string;
}

function formatInitHuman(files: FileResult[], skills: string[], nextSteps: string[]): string {
	const lines: string[] = [];

	lines.push(`  ${st(c.bold, "FILES")}`);
	for (const f of files) {
		const actionStyle = f.action === "created" ? c.green : f.action === "appended" ? c.cyan : c.dim;
		lines.push(`    ${st(actionStyle, f.action.padEnd(10))} ${f.path}`);
	}

	lines.push("");
	lines.push(`  ${st(c.bold, "SKILLS")}`);
	for (const s of skills) {
		lines.push(`    ${st(c.cyan, icon.arrow)} ${s}`);
	}

	lines.push("");
	lines.push(`  ${st(c.bold, "NEXT STEPS")}`);
	for (let i = 0; i < nextSteps.length; i++) {
		lines.push(`    ${st(c.dim, `${i + 1}.`)} ${nextSteps[i]}`);
	}

	return lines.join("\n");
}

export async function runInit(ctx: CommandContext): Promise<void> {
	const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
	const cwd = process.cwd();

	// Create skill directory with references
	const vxDir = join(cwd, ".claude", "skills", "vx");
	const refsDir = join(vxDir, "references");
	await mkdir(refsDir, { recursive: true });

	// Write SKILL.md
	const skillResult = await writeIfNotExists(join(vxDir, "SKILL.md"), VX_SKILL, force);

	// Write each reference file
	const refResults: FileResult[] = [];
	for (const [filename, content] of Object.entries(VX_REFERENCES)) {
		const result = await writeIfNotExists(join(refsDir, filename), content, force);
		refResults.push({ path: `.claude/skills/vx/references/${filename}`, action: result });
	}

	// Append to CLAUDE.md
	const claudeMdPath = join(cwd, "CLAUDE.md");
	const claudeMdResult = await appendClaudeMd(claudeMdPath, CLAUDE_MD_BLOCK, force);

	const files: FileResult[] = [
		{ path: ".claude/skills/vx/SKILL.md", action: skillResult },
		...refResults,
		{ path: "CLAUDE.md", action: claudeMdResult },
	];
	const skills = ["vx"];
	const nextSteps = ["Run /vx to configure OpenTelemetry and verify telemetry flows"];

	if (ctx.output.isHuman) {
		ctx.output.printHuman(formatInitHuman(files, skills, nextSteps));
	} else {
		ctx.output.print({ files, skills, next_steps: nextSteps });
	}
}

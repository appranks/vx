import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { appendClaudeMd, writeIfNotExists } from "../lib/preset-writer.ts";
import { c, icon, st } from "../lib/style.ts";
import { CLAUDE_MD_BLOCK, VX_SETUP_SKILL, VX_VERIFY_SKILL } from "../skills/content.ts";

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

	const setupDir = join(cwd, ".claude", "skills", "vx-setup");
	const verifyDir = join(cwd, ".claude", "skills", "vx-verify");
	await mkdir(setupDir, { recursive: true });
	await mkdir(verifyDir, { recursive: true });

	const setupResult = await writeIfNotExists(join(setupDir, "SKILL.md"), VX_SETUP_SKILL, force);
	const verifyResult = await writeIfNotExists(join(verifyDir, "SKILL.md"), VX_VERIFY_SKILL, force);

	const claudeMdPath = join(cwd, "CLAUDE.md");
	const claudeMdResult = await appendClaudeMd(claudeMdPath, CLAUDE_MD_BLOCK, force);

	const files: FileResult[] = [
		{ path: ".claude/skills/vx-setup/SKILL.md", action: setupResult },
		{ path: ".claude/skills/vx-verify/SKILL.md", action: verifyResult },
		{ path: "CLAUDE.md", action: claudeMdResult },
	];
	const skills = ["vx-setup", "vx-verify"];
	const nextSteps = [
		"Run /vx-setup to configure OpenTelemetry for this project",
		"Run /vx-verify after setup to confirm telemetry is flowing",
	];

	if (ctx.output.isHuman) {
		ctx.output.printHuman(formatInitHuman(files, skills, nextSteps));
	} else {
		ctx.output.print({ files, skills, next_steps: nextSteps });
	}
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { appendClaudeMd, writeIfNotExists } from "../lib/preset-writer.ts";
import { CLAUDE_MD_BLOCK, VX_SETUP_SKILL, VX_VERIFY_SKILL } from "../skills/content.ts";

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

	ctx.output.print({
		files: [
			{ path: ".claude/skills/vx-setup/SKILL.md", action: setupResult },
			{ path: ".claude/skills/vx-verify/SKILL.md", action: verifyResult },
			{ path: "CLAUDE.md", action: claudeMdResult },
		],
		skills: ["vx-setup", "vx-verify"],
		next_steps: [
			"Run /vx-setup to configure OpenTelemetry for this project",
			"Run /vx-verify after setup to confirm telemetry is flowing",
		],
	});
}

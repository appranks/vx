import type { CommandContext } from "../lib/context.ts";
import { composeRun } from "../lib/docker.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { getComposePath } from "../lib/paths.ts";
import { c, icon, st } from "../lib/style.ts";

export async function runDown(ctx: CommandContext): Promise<void> {
	const composePath = getComposePath();
	const composeExists = await Bun.file(composePath).exists();

	if (!composeExists) {
		if (ctx.output.isHuman) {
			ctx.output.printHuman(`  ${st(c.dim, icon.circle)} no stack to stop`);
		} else {
			ctx.output.print({ status: "not_running", message: "no stack to stop" });
		}
		return;
	}

	const result = composeRun(["down", "--volumes", "--remove-orphans"], composePath);
	if (result.exitCode !== 0) {
		ctx.output.error("docker compose down failed", result.stderr);
		exitWith(EXIT.STACK_ERROR);
	}

	if (ctx.output.isHuman) {
		ctx.output.printHuman(`  ${st(c.dim, icon.circle)} stack destroyed, all data removed`);
	} else {
		ctx.output.print({ status: "stopped", message: "stack destroyed, all data removed" });
	}
}

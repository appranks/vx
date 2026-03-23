import type { CommandContext } from "../lib/context.ts";
import { composeRun } from "../lib/docker.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { isStackRunning, waitForStack } from "../lib/health.ts";
import { ensureVxDir, getComposePath } from "../lib/paths.ts";
import { checkPortsAvailable } from "../lib/ports.ts";
import { generateComposeFile } from "../stack/compose.ts";
import { generateOtelConfig } from "../stack/otel.ts";

export async function runUp(ctx: CommandContext): Promise<void> {
	const running = await isStackRunning();
	if (running) {
		ctx.output.print({ status: "already_running", message: "stack is already running" });
		return;
	}

	try {
		await checkPortsAvailable();
	} catch (err) {
		ctx.output.error("port conflict", err instanceof Error ? err.message : String(err));
		exitWith(EXIT.STACK_ERROR);
	}

	await ensureVxDir();
	await generateComposeFile();
	await generateOtelConfig();

	const result = composeRun(["up", "-d"], getComposePath());
	if (result.exitCode !== 0) {
		ctx.output.error("docker compose up failed", result.stderr);
		exitWith(EXIT.STACK_ERROR);
	}

	try {
		await waitForStack();
	} catch (err) {
		ctx.output.error("stack health check timeout", err instanceof Error ? err.message : String(err));
		exitWith(EXIT.STACK_ERROR);
	}

	ctx.output.print({ status: "running", message: "stack is ready" });
}

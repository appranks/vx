import { runCheck } from "./commands/check.ts";
import { runDown } from "./commands/down.ts";
import { runInit } from "./commands/init.ts";
import { runLogs } from "./commands/logs.ts";
import { runMetrics } from "./commands/metrics.ts";
import { runStatus } from "./commands/status.ts";
import { runTraces } from "./commands/traces.ts";
import { runUp } from "./commands/up.ts";
import { parseGlobalFlags } from "./lib/args.ts";
import type { CommandHandler } from "./lib/context.ts";
import { buildContext } from "./lib/context.ts";
import { EXIT } from "./lib/exit.ts";
import { HELP_TEXT } from "./lib/help.ts";
import { buildOutputHelper } from "./lib/output.ts";
import { c, st } from "./lib/style.ts";
import { VERSION } from "./lib/version.ts";

const COMMANDS: Record<string, CommandHandler> = {
	up: runUp,
	down: runDown,
	status: runStatus,
	metrics: runMetrics,
	logs: runLogs,
	traces: runTraces,
	check: runCheck,
	init: runInit,
};

process.on("SIGINT", () => {
	process.stderr.write("\ninterrupted\n");
	process.exit(EXIT.OK);
});

process.on("SIGTERM", () => {
	process.stderr.write("terminated\n");
	process.exit(EXIT.OK);
});

async function main(): Promise<void> {
	const rawArgs = process.argv.slice(2);
	const flags = parseGlobalFlags(rawArgs);

	if (flags.version) {
		process.stdout.write(`  ${st(c.bold + c.cyan, "vx")} ${st(c.dim, VERSION)}\n`);
		process.exit(EXIT.OK);
	}

	const commandName = rawArgs.find((a) => !a.startsWith("-"));
	const handler = commandName ? COMMANDS[commandName] : undefined;

	if (flags.help && !handler) {
		process.stdout.write(`${HELP_TEXT}\n`);
		process.exit(EXIT.OK);
	}

	if (!handler) {
		const output = buildOutputHelper(flags);
		output.error(`unknown command: ${commandName ?? "(none)"}`, "Run vx --help for available commands");
		process.exit(EXIT.USER_ERROR);
	}

	const ctx = buildContext(rawArgs);
	await handler(ctx);
}

main().catch((err) => {
	process.stderr.write(`  ${st(c.bold + c.red, "fatal")}  ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(EXIT.STACK_ERROR);
});

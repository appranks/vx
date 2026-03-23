import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { isStackRunning } from "../lib/health.ts";
import { QueryError, queryLogs, queryMetrics, StackUnreachableError } from "../lib/http.ts";
import { c, icon, st } from "../lib/style.ts";

export async function runCheck(ctx: CommandContext): Promise<void> {
	const gate = ctx.args[0];
	if (!gate) {
		ctx.output.error("missing gate argument", "Usage: vx check <health|latency|errors> [query] [flags]");
		exitWith(EXIT.USER_ERROR);
	}

	switch (gate) {
		case "health":
			return checkHealth(ctx);
		case "latency":
			return checkLatency(ctx);
		case "errors":
			return checkErrors(ctx);
		default:
			ctx.output.error(`unknown gate: ${gate}`, "Available gates: health, latency, errors");
			exitWith(EXIT.USER_ERROR);
	}
}

function formatGate(passed: boolean, gate: string, detail: string): string {
	const sym = passed ? st(c.green, icon.ok) : st(c.red, icon.fail);
	const status = passed ? "passed" : st(c.red, "failed");
	return `  ${sym} ${st(c.bold, gate)} ${st(c.dim, "\u2014")} ${status}  ${st(c.dim, detail)}`;
}

async function checkHealth(ctx: CommandContext): Promise<void> {
	const healthy = await isStackRunning();
	if (healthy) {
		if (ctx.output.isHuman) {
			ctx.output.printHuman(formatGate(true, "health", "all services healthy"));
		} else {
			ctx.output.print({ gate: "health", status: "passed", message: "all services healthy" });
		}
	} else {
		ctx.output.error("health check failed", "one or more services are not responding");
		exitWith(EXIT.USER_ERROR);
	}
}

async function checkLatency(ctx: CommandContext): Promise<void> {
	const query = ctx.args[1];
	if (!query) {
		ctx.output.error("missing metric query", "Usage: vx check latency <metric> --max=<duration>");
		exitWith(EXIT.USER_ERROR);
	}

	const maxStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--max");
	if (!maxStr) {
		ctx.output.error("missing --max flag", "Usage: vx check latency <metric> --max=<duration>");
		exitWith(EXIT.USER_ERROR);
	}

	const maxSeconds = parseDuration(maxStr);
	if (maxSeconds === null) {
		ctx.output.error("invalid --max value", "Expected format: 1s, 2s, 500ms, etc.");
		exitWith(EXIT.USER_ERROR);
	}

	const isP99 = ctx.args.includes("--p99") || process.argv.includes("--p99");
	const quantile = isP99 ? "0.99" : "0.95";
	const wrappedQuery = `histogram_quantile(${quantile}, ${query})`;

	try {
		const result = await queryMetrics(wrappedQuery);
		if (result.result.length === 0) {
			if (ctx.output.isHuman) {
				ctx.output.printHuman(formatGate(true, "latency", `no data (max ${maxStr})`));
			} else {
				ctx.output.print({ gate: "latency", status: "passed", message: "no data", value: null, max: maxStr });
			}
			return;
		}

		const value = Number.parseFloat(result.result[0].value[1]);
		const passed = value <= maxSeconds;
		if (ctx.output.isHuman) {
			ctx.output.printHuman(formatGate(passed, "latency", `${value.toFixed(2)}s (max ${maxSeconds}s)`));
		} else {
			ctx.output.print({
				gate: "latency",
				status: passed ? "passed" : "failed",
				value,
				max: maxSeconds,
				query: wrappedQuery,
			});
		}
		if (!passed) exitWith(EXIT.USER_ERROR);
	} catch (err) {
		if (err instanceof QueryError) {
			ctx.output.error(err.message);
			exitWith(EXIT.USER_ERROR);
		}
		if (err instanceof StackUnreachableError) {
			ctx.output.error(err.message, err.cause);
			exitWith(EXIT.STACK_ERROR);
		}
		ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
		exitWith(EXIT.STACK_ERROR);
	}
}

async function checkErrors(ctx: CommandContext): Promise<void> {
	const query = ctx.args[1];
	if (!query) {
		ctx.output.error("missing logs query", "Usage: vx check errors <logsql> --max=<count>");
		exitWith(EXIT.USER_ERROR);
	}

	const maxStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--max");
	if (!maxStr) {
		ctx.output.error("missing --max flag", "Usage: vx check errors <logsql> --max=<count>");
		exitWith(EXIT.USER_ERROR);
	}

	const maxCount = Number.parseInt(maxStr, 10);
	if (Number.isNaN(maxCount) || maxCount < 0) {
		ctx.output.error("--max must be a non-negative integer");
		exitWith(EXIT.USER_ERROR);
	}

	try {
		const entries = await queryLogs(query, maxCount + 1);
		const count = entries.length;
		const passed = count <= maxCount;

		if (ctx.output.isHuman) {
			ctx.output.printHuman(formatGate(passed, "errors", `${count} found (max ${maxCount})`));
		} else {
			ctx.output.print({ gate: "errors", status: passed ? "passed" : "failed", count, max: maxCount, query });
		}
		if (!passed) exitWith(EXIT.USER_ERROR);
	} catch (err) {
		if (err instanceof QueryError) {
			ctx.output.error(err.message);
			exitWith(EXIT.USER_ERROR);
		}
		if (err instanceof StackUnreachableError) {
			ctx.output.error(err.message, err.cause);
			exitWith(EXIT.STACK_ERROR);
		}
		ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
		exitWith(EXIT.STACK_ERROR);
	}
}

function parseDuration(str: string): number | null {
	const msMatch = str.match(/^(\d+(?:\.\d+)?)ms$/);
	if (msMatch) return Number.parseFloat(msMatch[1]) / 1000;

	const sMatch = str.match(/^(\d+(?:\.\d+)?)s$/);
	if (sMatch) return Number.parseFloat(sMatch[1]);

	const mMatch = str.match(/^(\d+(?:\.\d+)?)m$/);
	if (mMatch) return Number.parseFloat(mMatch[1]) * 60;

	return null;
}

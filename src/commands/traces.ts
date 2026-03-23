import { parseFlag } from "../lib/args.ts";
import { QUERY_LIMITS } from "../lib/constants.ts";
import type { CommandContext } from "../lib/context.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { formatQueryResult } from "../lib/format.ts";
import type { TraceEntry } from "../lib/http.ts";
import { QueryError, queryTraces, StackUnreachableError } from "../lib/http.ts";
import { c, st } from "../lib/style.ts";
import { alignColumns } from "../lib/table.ts";

function formatDuration(us: number): string {
	if (us < 1000) return `${us}\u00b5s`;
	if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`;
	return `${(us / 1_000_000).toFixed(2)}s`;
}

function formatTracesHuman(query: string, entries: TraceEntry[]): string {
	const lines: string[] = [];
	lines.push(`  ${st(c.bold, "QUERY")}  ${st(c.dim, query)}`);
	lines.push(`  ${st(c.bold, "COUNT")}  ${entries.length} results`);

	if (entries.length > 0) {
		lines.push("");
		const header = [
			st(c.bold + c.dim, "TIME"),
			st(c.bold + c.dim, "TRACE"),
			st(c.bold + c.dim, "OPERATION"),
			st(c.bold + c.dim, "DURATION"),
		];
		const rows = entries.map((e) => [
			st(c.dim, e._time),
			st(c.cyan, e.traceID.slice(0, 8)),
			e.operationName,
			formatDuration(e.duration),
		]);
		lines.push(...alignColumns([header, ...rows]));
	}

	return lines.join("\n");
}

export async function runTraces(ctx: CommandContext): Promise<void> {
	const query = ctx.args[0];
	if (!query) {
		ctx.output.error("missing query argument", "Usage: vx traces <query>");
		exitWith(EXIT.USER_ERROR);
	}

	const limitStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--limit");
	const limit = limitStr ? Number.parseInt(limitStr, 10) : QUERY_LIMITS.traces;
	if (Number.isNaN(limit) || limit < 1) {
		ctx.output.error("--limit must be a positive integer");
		exitWith(EXIT.USER_ERROR);
	}

	try {
		const entries = await queryTraces(query, limit);
		if (ctx.output.isHuman) {
			ctx.output.printHuman(formatTracesHuman(query, entries));
		} else {
			ctx.output.print(formatQueryResult(query, entries));
		}
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

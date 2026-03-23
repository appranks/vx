import { parseFlag } from "../lib/args.ts";
import { QUERY_LIMITS } from "../lib/constants.ts";
import type { CommandContext } from "../lib/context.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { formatQueryResult } from "../lib/format.ts";
import { QueryError, queryTraces, StackUnreachableError } from "../lib/http.ts";

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
		ctx.output.print(formatQueryResult(query, entries));
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

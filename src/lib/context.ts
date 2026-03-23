import { type GlobalFlags, parseGlobalFlags, stripFlags } from "./args.ts";
import { buildOutputHelper, type OutputHelper } from "./output.ts";

export interface CommandContext {
	command: string;
	args: string[];
	flags: GlobalFlags;
	output: OutputHelper;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

export function buildContext(rawArgs: string[]): CommandContext {
	const command = rawArgs[0] ?? "";
	const rest = rawArgs.slice(1);
	const flags = parseGlobalFlags(rest);
	const args = stripFlags(rest);
	return { command, args, flags, output: buildOutputHelper(flags) };
}

import type { GlobalFlags } from "./args.ts";
import { c, st } from "./style.ts";

export interface OutputHelper {
	readonly isHuman: boolean;
	print(data: unknown): void;
	printHuman(text: string): void;
	error(message: string, detail?: unknown): void;
}

export function buildOutputHelper(flags: GlobalFlags): OutputHelper {
	const isJson = flags.json || !process.stdout.isTTY;
	const isHuman = !flags.json && !flags.quiet && (process.stdout.isTTY ?? false);

	return {
		isHuman,
		print(data: unknown): void {
			if (isJson) {
				process.stdout.write(`${JSON.stringify(data)}\n`);
			} else {
				process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
			}
		},
		printHuman(text: string): void {
			if (!flags.quiet) {
				process.stdout.write(`${text}\n`);
			}
		},
		error(message: string, detail?: unknown): void {
			if (isJson) {
				process.stderr.write(`${JSON.stringify({ error: message, detail })}\n`);
			} else {
				process.stderr.write(`  ${st(c.bold + c.red, "error")}  ${message}\n`);
				if (detail && flags.verbose) {
					process.stderr.write(`${st(c.dim, `         ${String(detail)}`)}\n`);
				}
			}
		},
	};
}

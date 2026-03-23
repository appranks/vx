import { vi } from "vitest";
import type { GlobalFlags } from "../../src/lib/args.ts";
import type { CommandContext } from "../../src/lib/context.ts";

export function buildMockContext(
	flagOverrides: Partial<GlobalFlags> = {},
	args: string[] = [],
): CommandContext & { printed: unknown[]; errors: string[] } {
	const printed: unknown[] = [];
	const errors: string[] = [];

	const flags: GlobalFlags = {
		json: true,
		quiet: false,
		verbose: false,
		help: false,
		version: false,
		...flagOverrides,
	};

	return {
		command: "test",
		args,
		flags,
		output: {
			print: vi.fn((data: unknown) => printed.push(data)),
			printHuman: vi.fn(),
			error: vi.fn((msg: string) => errors.push(msg)),
		},
		printed,
		errors,
	};
}

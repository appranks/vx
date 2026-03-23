export interface GlobalFlags {
	json: boolean;
	quiet: boolean;
	verbose: boolean;
	help: boolean;
	version: boolean;
}

export function parseGlobalFlags(args: string[]): GlobalFlags {
	return {
		json: args.includes("--json"),
		quiet: args.includes("--quiet"),
		verbose: args.includes("--verbose"),
		help: args.includes("--help") || args.includes("-h"),
		version: args.includes("--version") || args.includes("-v"),
	};
}

export function stripFlags(args: string[]): string[] {
	return args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
}

export function parseFlag(args: string[], name: string): string | undefined {
	// Handles --name=value and --name value
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === name && i + 1 < args.length) {
			return args[i + 1];
		}
		if (arg.startsWith(`${name}=`)) {
			return arg.slice(name.length + 1);
		}
	}
	return undefined;
}

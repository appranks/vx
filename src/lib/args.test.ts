import { describe, expect, it } from "vitest";
import { parseFlag, parseGlobalFlags, stripFlags } from "./args.ts";

describe("parseGlobalFlags", () => {
	it("detects --json flag", () => {
		const flags = parseGlobalFlags(["metrics", "--json", "up"]);
		expect(flags.json).toBe(true);
	});

	it("detects -h as help", () => {
		const flags = parseGlobalFlags(["-h"]);
		expect(flags.help).toBe(true);
	});

	it("detects -v as version", () => {
		const flags = parseGlobalFlags(["-v"]);
		expect(flags.version).toBe(true);
	});

	it("detects --verbose flag", () => {
		const flags = parseGlobalFlags(["--verbose"]);
		expect(flags.verbose).toBe(true);
	});

	it("detects --quiet flag", () => {
		const flags = parseGlobalFlags(["--quiet"]);
		expect(flags.quiet).toBe(true);
	});

	it("all flags default to false when not present", () => {
		const flags = parseGlobalFlags(["metrics", "up"]);
		expect(flags.json).toBe(false);
		expect(flags.quiet).toBe(false);
		expect(flags.verbose).toBe(false);
		expect(flags.help).toBe(false);
		expect(flags.version).toBe(false);
	});
});

describe("stripFlags", () => {
	it("removes all -- prefixed args", () => {
		const positional = stripFlags(["--json", "up", "--verbose", "myquery"]);
		expect(positional).toEqual(["up", "myquery"]);
	});

	it("removes single-dash flags", () => {
		const positional = stripFlags(["-h", "status", "-v"]);
		expect(positional).toEqual(["status"]);
	});

	it("returns empty array when all args are flags", () => {
		const positional = stripFlags(["--json", "--quiet"]);
		expect(positional).toEqual([]);
	});
});

describe("parseFlag", () => {
	it("parses --limit=100 format", () => {
		const value = parseFlag(["query", "--limit=100"], "--limit");
		expect(value).toBe("100");
	});

	it("parses --limit 100 format", () => {
		const value = parseFlag(["query", "--limit", "100"], "--limit");
		expect(value).toBe("100");
	});

	it("returns undefined when flag is not present", () => {
		const value = parseFlag(["query"], "--limit");
		expect(value).toBeUndefined();
	});

	it("parses --max=2s format", () => {
		const value = parseFlag(["latency", "metric", "--max=2s"], "--max");
		expect(value).toBe("2s");
	});
});

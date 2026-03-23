import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalFlags } from "./args.ts";
import { buildOutputHelper } from "./output.ts";

const baseFlags: GlobalFlags = {
	json: false,
	quiet: false,
	verbose: false,
	help: false,
	version: false,
};

describe("buildOutputHelper", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("print outputs JSON when --json is set", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const helper = buildOutputHelper({ ...baseFlags, json: true });
		helper.print({ key: "value" });
		expect(writeSpy).toHaveBeenCalledWith('{"key":"value"}\n');
	});

	it("error writes to stderr", () => {
		const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const helper = buildOutputHelper({ ...baseFlags, json: true });
		helper.error("test error");
		expect(writeSpy).toHaveBeenCalled();
		const output = writeSpy.mock.calls[0][0] as string;
		expect(output).toContain("test error");
	});

	it("printHuman suppresses output when quiet is true", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const helper = buildOutputHelper({ ...baseFlags, quiet: true });
		helper.printHuman("should not appear");
		expect(writeSpy).not.toHaveBeenCalled();
	});

	it("printHuman outputs text when quiet is false", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const helper = buildOutputHelper({ ...baseFlags, json: true, quiet: false });
		helper.printHuman("hello");
		expect(writeSpy).toHaveBeenCalledWith("hello\n");
	});
});

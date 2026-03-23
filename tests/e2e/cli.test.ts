import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PATH = join(import.meta.dirname, "../../src/cli.ts");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
	const proc = spawnSync("bun", ["run", CLI_PATH, ...args], {
		encoding: "utf-8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	return {
		stdout: (proc.stdout ?? "").trim(),
		stderr: (proc.stderr ?? "").trim(),
		exitCode: proc.status ?? 1,
	};
}

const stackRunning = (() => {
	const { stdout } = runCli(["status"]);
	try {
		const output = JSON.parse(stdout);
		return output.services?.some((svc: { status: string }) => svc.status === "healthy");
	} catch {
		return false;
	}
})();

describe("CLI e2e", () => {
	it("prints version with --version", () => {
		const { stdout, exitCode } = runCli(["--version"]);
		expect(stdout).toMatch(/^vx \d+\.\d+\.\d+$/);
		expect(exitCode).toBe(0);
	});

	it("prints version with -v", () => {
		const { stdout, exitCode } = runCli(["-v"]);
		expect(stdout).toMatch(/^vx \d+\.\d+\.\d+$/);
		expect(exitCode).toBe(0);
	});

	it("prints help with --help", () => {
		const { stdout, exitCode } = runCli(["--help"]);
		expect(stdout).toContain("USAGE");
		expect(stdout).toContain("COMMANDS");
		expect(stdout).toContain("GLOBAL FLAGS");
		expect(exitCode).toBe(0);
	});

	it("prints help with -h", () => {
		const { stdout, exitCode } = runCli(["-h"]);
		expect(stdout).toContain("USAGE");
		expect(exitCode).toBe(0);
	});

	it("exits 1 on unknown command", () => {
		const { stderr, exitCode } = runCli(["nonexistent"]);
		expect(stderr).toContain("unknown command");
		expect(exitCode).toBe(1);
	});

	it("exits 1 when no command given", () => {
		const { stderr, exitCode } = runCli([]);
		expect(stderr).toContain("unknown command");
		expect(exitCode).toBe(1);
	});

	it("exits 1 when metrics called without query", () => {
		const { stderr, exitCode } = runCli(["metrics"]);
		expect(stderr).toContain("missing query");
		expect(exitCode).toBe(1);
	});

	it.skipIf(stackRunning)("exits 2 when metrics called with query but stack not running", () => {
		const { stderr, exitCode } = runCli(["metrics", "up"]);
		expect(stderr).toContain("unreachable");
		expect(exitCode).toBe(2);
	});

	it.skipIf(stackRunning)("status reports unreachable services when stack not running", () => {
		const { stdout, exitCode } = runCli(["status"]);
		const output = JSON.parse(stdout);
		expect(output.services).toHaveLength(4);
		for (const svc of output.services) {
			expect(svc.status).toBe("unreachable");
		}
		expect(exitCode).toBe(0);
	});

	it.skipIf(stackRunning)("check health exits 1 when stack not running", () => {
		const { exitCode } = runCli(["check", "health"]);
		expect(exitCode).toBe(1);
	});
});

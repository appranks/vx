import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: false,
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "lcov"],
			include: ["src/**/*.ts"],
			exclude: ["src/cli.ts", "src/**/*.d.ts", "src/**/*.test.ts"],
			thresholds: {
				lines: 70,
				functions: 65,
				branches: 60,
			},
		},
	},
});

import { describe, expect, it } from "vitest";
import { getComposePath, getOtelConfigPath, getVxDir } from "./paths.ts";

describe("getVxDir", () => {
	it("returns .vx relative to cwd", () => {
		const dir = getVxDir();
		expect(dir).toMatch(/\.vx$/);
		expect(dir).toContain(process.cwd());
	});
});

describe("getComposePath", () => {
	it("returns docker-compose.yml inside .vx", () => {
		const path = getComposePath();
		expect(path).toMatch(/\.vx\/docker-compose\.yml$/);
	});
});

describe("getOtelConfigPath", () => {
	it("returns otel-collector.yaml inside .vx", () => {
		const path = getOtelConfigPath();
		expect(path).toMatch(/\.vx\/otel-collector\.yaml$/);
	});
});

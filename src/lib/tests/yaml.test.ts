import { describe, expect, it } from "vitest";
import { toYaml } from "../yaml.ts";

describe("toYaml", () => {
	it("serializes a simple object", () => {
		const yaml = toYaml({ name: "vx", version: 1 });
		expect(yaml).toContain("name: vx");
		expect(yaml).toContain("version: 1");
	});

	it("serializes nested objects with indentation", () => {
		const yaml = toYaml({ parent: { child: "value" } });
		expect(yaml).toContain("parent:");
		expect(yaml).toContain("  child: value");
	});

	it("serializes arrays", () => {
		const yaml = toYaml({ ports: ["8428:8428", "9428:9428"] });
		expect(yaml).toContain("ports:");
		expect(yaml).toContain('- "8428:8428"');
	});

	it("quotes strings with special characters", () => {
		const yaml = toYaml({ cmd: "http://localhost:8428/health" });
		expect(yaml).toContain('"http://localhost:8428/health"');
	});

	it("handles null values", () => {
		const yaml = toYaml({ "vx-vm-data": null });
		expect(yaml).toContain("vx-vm-data:");
	});

	it("serializes booleans", () => {
		const yaml = toYaml({ enabled: true });
		expect(yaml).toContain("enabled: true");
	});

	it("handles empty objects", () => {
		const yaml = toYaml({ batch: {} });
		expect(yaml).toContain("batch:");
		expect(yaml).toContain("{}");
	});
});

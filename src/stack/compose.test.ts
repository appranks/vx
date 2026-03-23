import { describe, expect, it } from "vitest";
import { IMAGES, VX_PROJECT_NAME } from "../lib/constants.ts";
import { buildComposeConfig } from "./compose.ts";

describe("buildComposeConfig", () => {
	it("uses the vx project name", () => {
		const config = buildComposeConfig();
		expect(config.name).toBe(VX_PROJECT_NAME);
	});

	it("uses exact image versions from constants", () => {
		const config = buildComposeConfig();
		expect(config.services["victoria-metrics"].image).toBe(IMAGES.victoriaMetrics);
		expect(config.services["victoria-logs"].image).toBe(IMAGES.victoriaLogs);
		expect(config.services["victoria-traces"].image).toBe(IMAGES.victoriaTraces);
		expect(config.services["otel-collector"].image).toBe(IMAGES.otelCollector);
	});

	it("all services are on vx-net", () => {
		const config = buildComposeConfig();
		for (const service of Object.values(config.services)) {
			expect(service.networks).toContain("vx-net");
		}
	});

	it("all volumes have vx- prefix", () => {
		const config = buildComposeConfig();
		for (const volumeName of Object.keys(config.volumes)) {
			expect(volumeName).toMatch(/^vx-/);
		}
	});

	it("all services have restart no", () => {
		const config = buildComposeConfig();
		for (const service of Object.values(config.services)) {
			expect(service.restart).toBe("no");
		}
	});

	it("all services have healthcheck", () => {
		const config = buildComposeConfig();
		for (const service of Object.values(config.services)) {
			expect(service.healthcheck).toBeDefined();
			expect(service.healthcheck.test).toBeInstanceOf(Array);
		}
	});

	it("otel-collector depends on all victoria services", () => {
		const config = buildComposeConfig();
		const collector = config.services["otel-collector"];
		expect(collector.depends_on).toHaveProperty("victoria-metrics");
		expect(collector.depends_on).toHaveProperty("victoria-logs");
		expect(collector.depends_on).toHaveProperty("victoria-traces");
	});

	it("exposes correct ports", () => {
		const config = buildComposeConfig();
		expect(config.services["victoria-metrics"].ports).toContain("8428:8428");
		expect(config.services["victoria-logs"].ports).toContain("9428:9428");
		expect(config.services["victoria-traces"].ports).toContain("10428:10428");
		expect(config.services["otel-collector"].ports).toContain("4317:4317");
		expect(config.services["otel-collector"].ports).toContain("4318:4318");
	});
});

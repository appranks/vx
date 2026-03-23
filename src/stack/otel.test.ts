import { describe, expect, it } from "vitest";
import { buildOtelConfig } from "./otel.ts";

describe("buildOtelConfig", () => {
	it("has otlp receiver", () => {
		const config = buildOtelConfig();
		expect(config.receivers).toHaveProperty("otlp");
	});

	it("has three exporters for metrics, logs, and traces", () => {
		const config = buildOtelConfig();
		expect(config.exporters).toHaveProperty("otlphttp_metrics");
		expect(config.exporters).toHaveProperty("otlphttp_logs");
		expect(config.exporters).toHaveProperty("otlphttp_traces");
	});

	it("has batch processor", () => {
		const config = buildOtelConfig();
		expect(config.processors).toHaveProperty("batch");
	});

	it("has three pipelines", () => {
		const config = buildOtelConfig();
		expect(config.service.pipelines).toHaveProperty("metrics");
		expect(config.service.pipelines).toHaveProperty("logs");
		expect(config.service.pipelines).toHaveProperty("traces");
	});

	it("each pipeline uses otlp receiver and batch processor", () => {
		const config = buildOtelConfig();
		for (const pipeline of Object.values(config.service.pipelines)) {
			expect(pipeline.receivers).toContain("otlp");
			expect(pipeline.processors).toContain("batch");
		}
	});

	it("metrics pipeline exports to otlphttp_metrics", () => {
		const config = buildOtelConfig();
		expect(config.service.pipelines.metrics.exporters).toContain("otlphttp_metrics");
	});

	it("has health_check extension", () => {
		const config = buildOtelConfig();
		expect(config.extensions).toHaveProperty("health_check");
		expect(config.service.extensions).toContain("health_check");
	});
});

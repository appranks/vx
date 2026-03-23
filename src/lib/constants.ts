export const VX_PROJECT_NAME = "vx";
export const VX_NETWORK = "vx-net";

export const IMAGES = {
	victoriaMetrics: "victoriametrics/victoria-metrics:v1.138.0",
	victoriaLogs: "victoriametrics/victoria-logs:v1.48.0",
	victoriaTraces: "victoriametrics/victoria-traces:v0.8.0",
	otelCollector: "otel/opentelemetry-collector-contrib:0.148.0",
} as const;

export const TIMEOUTS = {
	metrics: 10_000,
	logs: 15_000,
	traces: 15_000,
	health: 3_000,
} as const;

export const QUERY_LIMITS = {
	metrics: 1000,
	logs: 100,
	traces: 50,
} as const;

export const REQUIRED_PORTS = [4317, 4318, 8428, 9428, 10428] as const;

export const HEALTH_ENDPOINTS = [
	{ name: "victoria-metrics", url: "http://localhost:8428/health" },
	{ name: "victoria-logs", url: "http://localhost:9428/health" },
	{ name: "victoria-traces", url: "http://localhost:10428/health" },
	{ name: "otel-collector", url: "http://localhost:4318/" },
] as const;

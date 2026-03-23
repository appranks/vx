import { getOtelConfigPath } from "../lib/paths.ts";
import { toYaml } from "../lib/yaml.ts";

export interface OtelConfig {
	receivers: Record<string, unknown>;
	exporters: Record<string, unknown>;
	processors: Record<string, unknown>;
	extensions: Record<string, unknown>;
	service: {
		extensions: string[];
		pipelines: Record<string, { receivers: string[]; processors: string[]; exporters: string[] }>;
	};
}

export function buildOtelConfig(): OtelConfig {
	return {
		receivers: {
			otlp: {
				protocols: {
					grpc: { endpoint: "0.0.0.0:4317" },
					http: { endpoint: "0.0.0.0:4318" },
				},
			},
		},
		exporters: {
			otlphttp_metrics: {
				endpoint: "http://victoria-metrics:8428",
				tls: { insecure: true },
			},
			otlphttp_logs: {
				endpoint: "http://victoria-logs:9428/insert/opentelemetry",
				tls: { insecure: true },
			},
			otlphttp_traces: {
				endpoint: "http://victoria-traces:10428/insert/opentelemetry",
				tls: { insecure: true },
			},
		},
		processors: {
			batch: {},
		},
		extensions: {
			health_check: {
				endpoint: "0.0.0.0:13133",
			},
		},
		service: {
			extensions: ["health_check"],
			pipelines: {
				metrics: {
					receivers: ["otlp"],
					processors: ["batch"],
					exporters: ["otlphttp_metrics"],
				},
				logs: {
					receivers: ["otlp"],
					processors: ["batch"],
					exporters: ["otlphttp_logs"],
				},
				traces: {
					receivers: ["otlp"],
					processors: ["batch"],
					exporters: ["otlphttp_traces"],
				},
			},
		},
	};
}

export async function generateOtelConfig(): Promise<void> {
	const config = buildOtelConfig();
	const yaml = toYaml(config);
	await Bun.write(getOtelConfigPath(), `${yaml}\n`);
}

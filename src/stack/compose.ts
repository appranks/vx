import { IMAGES, VX_NETWORK, VX_PROJECT_NAME } from "../lib/constants.ts";
import { getComposePath } from "../lib/paths.ts";
import { toYaml } from "../lib/yaml.ts";

interface HealthcheckDef {
	test: string[];
	interval: string;
	timeout: string;
	retries: number;
	start_period: string;
}

interface ServiceDef {
	image: string;
	ports: string[];
	command?: string[];
	volumes?: string[];
	networks: string[];
	healthcheck: HealthcheckDef;
	restart: "no";
	depends_on?: Record<string, { condition: string }>;
}

export interface ComposeConfig {
	name: string;
	services: Record<string, ServiceDef>;
	volumes: Record<string, null>;
	networks: Record<string, { driver: string }>;
}

function buildVictoriaMetrics(): ServiceDef {
	return {
		image: IMAGES.victoriaMetrics,
		ports: ["8428:8428"],
		command: ["-retentionPeriod=1d", "-memory.allowedPercent=30", "-storageDataPath=/victoria-metrics-data"],
		volumes: ["vx-vm-data:/victoria-metrics-data"],
		networks: [VX_NETWORK],
		healthcheck: {
			test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8428/health"],
			interval: "5s",
			timeout: "3s",
			retries: 10,
			start_period: "10s",
		},
		restart: "no",
	};
}

function buildVictoriaLogs(): ServiceDef {
	return {
		image: IMAGES.victoriaLogs,
		ports: ["9428:9428"],
		command: ["-retentionPeriod=1d", "-memory.allowedPercent=30", "-storageDataPath=/victoria-logs-data"],
		volumes: ["vx-vl-data:/victoria-logs-data"],
		networks: [VX_NETWORK],
		healthcheck: {
			test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:9428/health"],
			interval: "5s",
			timeout: "3s",
			retries: 10,
			start_period: "10s",
		},
		restart: "no",
	};
}

function buildVictoriaTraces(): ServiceDef {
	return {
		image: IMAGES.victoriaTraces,
		ports: ["10428:10428"],
		command: ["-retentionPeriod=1d", "-memory.allowedPercent=30", "-storageDataPath=/victoria-traces-data"],
		volumes: ["vx-vt-data:/victoria-traces-data"],
		networks: [VX_NETWORK],
		healthcheck: {
			test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:10428/health"],
			interval: "5s",
			timeout: "3s",
			retries: 10,
			start_period: "10s",
		},
		restart: "no",
	};
}

function buildOtelCollector(): ServiceDef {
	return {
		image: IMAGES.otelCollector,
		ports: ["4317:4317", "4318:4318"],
		volumes: ["./otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro"],
		networks: [VX_NETWORK],
		healthcheck: {
			test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:13133/"],
			interval: "5s",
			timeout: "3s",
			retries: 10,
			start_period: "10s",
		},
		restart: "no",
		depends_on: {
			"victoria-metrics": { condition: "service_healthy" },
			"victoria-logs": { condition: "service_healthy" },
			"victoria-traces": { condition: "service_healthy" },
		},
	};
}

export function buildComposeConfig(): ComposeConfig {
	return {
		name: VX_PROJECT_NAME,
		services: {
			"victoria-metrics": buildVictoriaMetrics(),
			"victoria-logs": buildVictoriaLogs(),
			"victoria-traces": buildVictoriaTraces(),
			"otel-collector": buildOtelCollector(),
		},
		volumes: {
			"vx-vm-data": null,
			"vx-vl-data": null,
			"vx-vt-data": null,
		},
		networks: {
			[VX_NETWORK]: { driver: "bridge" },
		},
	};
}

export async function generateComposeFile(): Promise<void> {
	const config = buildComposeConfig();
	const yaml = toYaml(config);
	await Bun.write(getComposePath(), `${yaml}\n`);
}

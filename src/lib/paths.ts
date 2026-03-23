import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function getVxDir(): string {
	return join(process.cwd(), ".vx");
}

export function getComposePath(): string {
	return join(getVxDir(), "docker-compose.yml");
}

export function getOtelConfigPath(): string {
	return join(getVxDir(), "otel-collector.yaml");
}

export async function ensureVxDir(): Promise<void> {
	await mkdir(getVxDir(), { recursive: true });
}

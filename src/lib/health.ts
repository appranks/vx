import { HEALTH_ENDPOINTS, TIMEOUTS } from "./constants.ts";

const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

export async function waitForStack(): Promise<void> {
	const deadline = Date.now() + TIMEOUT_MS;

	while (Date.now() < deadline) {
		const results = await Promise.allSettled(
			HEALTH_ENDPOINTS.map(({ url }) => fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.health) })),
		);

		const allHealthy = results.every((r) => r.status === "fulfilled" && r.value.ok);

		if (allHealthy) return;

		await Bun.sleep(POLL_INTERVAL_MS);
	}

	throw new Error(`stack not ready after ${TIMEOUT_MS / 1000}s`);
}

export async function isStackRunning(): Promise<boolean> {
	const results = await Promise.allSettled(
		HEALTH_ENDPOINTS.map(({ url }) => fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.health) })),
	);

	return results.every((r) => r.status === "fulfilled" && r.value.ok);
}

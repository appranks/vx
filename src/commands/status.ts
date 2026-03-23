import { HEALTH_ENDPOINTS, TIMEOUTS } from "../lib/constants.ts";
import type { CommandContext } from "../lib/context.ts";

export async function runStatus(ctx: CommandContext): Promise<void> {
	const checks = await Promise.allSettled(
		HEALTH_ENDPOINTS.map(async ({ name, url }) => {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.health) });
			return { name, healthy: res.ok, port: Number(new URL(url).port) };
		}),
	);

	const services = checks.map((result, i) => {
		const { name } = HEALTH_ENDPOINTS[i];
		const port = Number(new URL(HEALTH_ENDPOINTS[i].url).port);
		if (result.status === "fulfilled") {
			return {
				name,
				status: result.value.healthy ? "healthy" : "degraded",
				port,
			};
		}
		return { name, status: "unreachable", port };
	});

	ctx.output.print({ services });
}

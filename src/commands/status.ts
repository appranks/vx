import { HEALTH_ENDPOINTS, TIMEOUTS } from "../lib/constants.ts";
import type { CommandContext } from "../lib/context.ts";
import { c, icon, st } from "../lib/style.ts";
import { alignColumns } from "../lib/table.ts";

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

	if (ctx.output.isHuman) {
		const statusCell = (s: string) => {
			if (s === "healthy") return `${st(c.green, icon.ok)} ${s}`;
			if (s === "degraded") return `${st(c.yellow, icon.warn)} ${s}`;
			return `${st(c.red, icon.fail)} ${s}`;
		};

		const header = [st(c.bold + c.dim, "SERVICE"), st(c.bold + c.dim, "PORT"), st(c.bold + c.dim, "STATUS")];
		const rows = services.map((svc) => [svc.name, st(c.dim, `:${svc.port}`), statusCell(svc.status)]);
		ctx.output.printHuman(alignColumns([header, ...rows]).join("\n"));
	} else {
		ctx.output.print({ services });
	}
}

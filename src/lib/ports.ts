import { REQUIRED_PORTS } from "./constants.ts";

export async function checkPortsAvailable(): Promise<void> {
	const conflicts: number[] = [];

	for (const port of REQUIRED_PORTS) {
		try {
			const res = await fetch(`http://localhost:${port}`, {
				signal: AbortSignal.timeout(500),
			});
			if (res) conflicts.push(port);
		} catch {
			// ECONNREFUSED = port is free, expected
		}
	}

	if (conflicts.length > 0) {
		throw new Error(
			`ports already in use: ${conflicts.join(", ")}. Stop the conflicting services before running vx up`,
		);
	}
}

import { join } from "node:path";

export type PresetName = "hono" | "nextjs" | "generic";

export async function detectPreset(): Promise<PresetName> {
	const pkgPath = join(process.cwd(), "package.json");
	const file = Bun.file(pkgPath);

	if (!(await file.exists())) {
		return "generic";
	}

	const pkg = (await file.json()) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		workspaces?: unknown;
	};

	if (pkg.workspaces) {
		return "generic";
	}

	const allDeps = {
		...pkg.dependencies,
		...pkg.devDependencies,
	};

	if ("hono" in allDeps) return "hono";
	if ("next" in allDeps) return "nextjs";
	return "generic";
}

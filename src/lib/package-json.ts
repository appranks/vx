import { join } from "node:path";

export async function injectDependencies(
	deps: Record<string, string>,
	dev = false,
): Promise<{ added: string[]; skipped: string[] }> {
	const pkgPath = join(process.cwd(), "package.json");
	const file = Bun.file(pkgPath);
	const exists = await file.exists();

	const pkg = exists ? ((await file.json()) as Record<string, unknown>) : { name: "my-app", version: "1.0.0" };

	const field = dev ? "devDependencies" : "dependencies";
	const existing = (pkg[field] as Record<string, string>) ?? {};

	const added: string[] = [];
	const skipped: string[] = [];

	for (const [name, version] of Object.entries(deps)) {
		if (existing[name]) {
			skipped.push(`${name}@${existing[name]} (keeping existing)`);
		} else {
			existing[name] = version;
			added.push(`${name}@${version}`);
		}
	}

	pkg[field] = existing;
	await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

	return { added, skipped };
}

export async function writeIfNotExists(path: string, content: string, force: boolean): Promise<"created" | "skipped"> {
	const file = Bun.file(path);
	const exists = await file.exists();

	if (exists && !force) {
		return "skipped";
	}

	await Bun.write(path, content);
	return "created";
}

export async function writeIfNotExists(path: string, content: string, force: boolean): Promise<"created" | "skipped"> {
	const file = Bun.file(path);
	const exists = await file.exists();

	if (exists && !force) {
		return "skipped";
	}

	await Bun.write(path, content);
	return "created";
}

const VX_MARKER = "## vx";

export async function appendClaudeMd(
	path: string,
	block: string,
	force: boolean,
): Promise<"created" | "appended" | "skipped"> {
	const file = Bun.file(path);
	const exists = await file.exists();

	if (!exists) {
		await Bun.write(path, `${block}\n`);
		return "created";
	}

	const content = await file.text();

	if (content.includes(VX_MARKER) && !force) {
		return "skipped";
	}

	if (content.includes(VX_MARKER) && force) {
		const before = content.slice(0, content.indexOf(VX_MARKER));
		await Bun.write(path, `${before.trimEnd()}\n\n${block}\n`);
		return "appended";
	}

	const separator = content.endsWith("\n") ? "\n" : "\n\n";
	await Bun.write(path, `${content}${separator}${block}\n`);
	return "appended";
}

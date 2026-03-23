import type { CommandContext } from "../lib/context.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { detectPreset, type PresetName } from "../presets/detect.ts";
import { initGeneric } from "../presets/generic.ts";
import { initHono } from "../presets/hono.ts";
import { initNextjs } from "../presets/nextjs.ts";

const PRESETS: Record<PresetName, (ctx: CommandContext) => Promise<void>> = {
	hono: initHono,
	nextjs: initNextjs,
	generic: initGeneric,
};

export async function runInit(ctx: CommandContext): Promise<void> {
	const presetArg = ctx.args[0] as PresetName | undefined;
	const presetName = presetArg ?? (await detectPreset());

	const handler = PRESETS[presetName];
	if (!handler) {
		ctx.output.error(`unknown preset: ${presetName}`, `Available presets: ${Object.keys(PRESETS).join(", ")}`);
		exitWith(EXIT.USER_ERROR);
		return;
	}

	await handler(ctx);
}

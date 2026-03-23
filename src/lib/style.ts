const enabled = process.stdout.isTTY ?? false;

function esc(code: string): string {
	return enabled ? `\x1b[${code}m` : "";
}

export const c = {
	reset: esc("0"),
	bold: esc("1"),
	dim: esc("2"),
	red: esc("31"),
	green: esc("32"),
	yellow: esc("33"),
	cyan: esc("36"),
	gray: esc("90"),
} as const;

export const icon = {
	ok: enabled ? "\u2713" : "ok",
	fail: enabled ? "\u2717" : "fail",
	dot: enabled ? "\u25cf" : "*",
	circle: enabled ? "\u25cb" : "o",
	arrow: enabled ? "\u25b8" : ">",
	warn: enabled ? "\u26a0" : "!",
	skip: enabled ? "\u2298" : "-",
} as const;

export function st(style: string, text: string): string {
	if (!enabled) return text;
	return `${style}${text}${c.reset}`;
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function visibleLength(text: string): number {
	return text.replace(ANSI_PATTERN, "").length;
}

export function pad(text: string, width: number): string {
	const visible = visibleLength(text);
	return visible >= width ? text : text + " ".repeat(width - visible);
}

import { visibleLength } from "./style.ts";

export function alignColumns(rows: string[][], gap = 2): string[] {
	if (rows.length === 0) return [];

	const colCount = Math.max(...rows.map((r) => r.length));
	const widths: number[] = Array(colCount).fill(0);

	for (const row of rows) {
		for (let i = 0; i < row.length; i++) {
			widths[i] = Math.max(widths[i], visibleLength(row[i]));
		}
	}

	return rows.map((row) => {
		const cells = row.map((cell, i) => {
			if (i === row.length - 1) return cell;
			const vLen = visibleLength(cell);
			return cell + " ".repeat(Math.max(0, widths[i] - vLen + gap));
		});
		return `  ${cells.join("")}`;
	});
}

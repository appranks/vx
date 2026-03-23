export function toYaml(obj: unknown, indent = 0): string {
	if (obj === null || obj === undefined) {
		return "null";
	}

	if (typeof obj === "string") {
		// Quote strings that contain special YAML characters
		if (
			obj === "" ||
			obj.includes(":") ||
			obj.includes("#") ||
			obj.includes("{") ||
			obj.includes("}") ||
			obj.includes("[") ||
			obj.includes("]") ||
			obj.includes(",") ||
			obj.includes("&") ||
			obj.includes("*") ||
			obj.includes("?") ||
			obj.includes("|") ||
			obj.includes(">") ||
			obj.includes("!") ||
			obj.includes("%") ||
			obj.includes("@") ||
			obj.includes("`") ||
			obj.includes("'") ||
			obj.includes('"') ||
			obj.startsWith(" ") ||
			obj.endsWith(" ") ||
			obj === "true" ||
			obj === "false" ||
			obj === "null" ||
			obj === "yes" ||
			obj === "no" ||
			/^\d+$/.test(obj)
		) {
			return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
		}
		return obj;
	}

	if (typeof obj === "number" || typeof obj === "boolean") {
		return String(obj);
	}

	const pad = "  ".repeat(indent);

	if (Array.isArray(obj)) {
		if (obj.length === 0) return "[]";

		// Check if all items are simple (string, number, boolean)
		const allSimple = obj.every((item) => typeof item !== "object" || item === null);
		if (allSimple) {
			return obj.map((item) => `${pad}- ${toYaml(item, 0)}`).join("\n");
		}

		return obj
			.map((item) => {
				if (typeof item === "object" && item !== null && !Array.isArray(item)) {
					const entries = Object.entries(item as Record<string, unknown>);
					if (entries.length === 0) return `${pad}-`;
					const [firstKey, firstVal] = entries[0];
					const firstLine = `${pad}- ${firstKey}: ${typeof firstVal === "object" && firstVal !== null ? "" : toYaml(firstVal, 0)}`;
					const rest = entries.slice(1).map(([k, v]) => {
						if (typeof v === "object" && v !== null) {
							return `${pad}  ${k}:\n${toYaml(v, indent + 2)}`;
						}
						return `${pad}  ${k}: ${toYaml(v, 0)}`;
					});
					if (typeof firstVal === "object" && firstVal !== null) {
						return `${pad}- ${firstKey}:\n${toYaml(firstVal, indent + 2)}${rest.length > 0 ? `\n${rest.join("\n")}` : ""}`;
					}
					return [firstLine, ...rest].join("\n");
				}
				return `${pad}- ${toYaml(item, 0)}`;
			})
			.join("\n");
	}

	if (typeof obj === "object") {
		const entries = Object.entries(obj as Record<string, unknown>);
		if (entries.length === 0) return "{}";

		return entries
			.map(([key, val]) => {
				if (val === null || val === undefined) {
					return `${pad}${key}:`;
				}
				if (typeof val === "object") {
					const nested = toYaml(val, indent + 1);
					return `${pad}${key}:\n${nested}`;
				}
				return `${pad}${key}: ${toYaml(val, 0)}`;
			})
			.join("\n");
	}

	return String(obj);
}

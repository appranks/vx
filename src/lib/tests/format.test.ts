import { describe, expect, it } from "vitest";
import { formatQueryResult } from "../format.ts";

describe("formatQueryResult", () => {
	it("wraps results with query and count", () => {
		const output = formatQueryResult("up", [{ value: 1 }, { value: 2 }]);
		expect(output.query).toBe("up");
		expect(output.count).toBe(2);
		expect(output.results).toHaveLength(2);
	});

	it("returns count 0 for empty results", () => {
		const output = formatQueryResult("no_results", []);
		expect(output.count).toBe(0);
		expect(output.results).toEqual([]);
	});

	it("preserves the original query string", () => {
		const output = formatQueryResult("rate(http_requests_total[5m])", []);
		expect(output.query).toBe("rate(http_requests_total[5m])");
	});
});

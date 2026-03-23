import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryError, queryLogs, queryMetrics, queryTraces, StackUnreachableError, victoriaGet } from "./http.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("victoriaGet", () => {
	it("returns response on successful fetch", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
		const res = await victoriaGet("http://localhost:8428/health", 5000);
		expect(res.ok).toBe(true);
	});

	it("throws StackUnreachableError when fetch throws", async () => {
		global.fetch = (vi.fn() as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
		await expect(victoriaGet("http://localhost:8428/health")).rejects.toThrow(StackUnreachableError);
	});

	it("throws QueryError on 400 response", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response("bad query", { status: 400 }));
		await expect(victoriaGet("http://localhost:8428/api/v1/query")).rejects.toThrow(QueryError);
	});

	it("throws StackUnreachableError on 500 response", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response("internal error", { status: 500 }));
		await expect(victoriaGet("http://localhost:8428/health")).rejects.toThrow(StackUnreachableError);
	});
});

describe("queryMetrics", () => {
	it("parses a successful vector response", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					status: "success",
					data: {
						resultType: "vector",
						result: [{ metric: { job: "api" }, value: [1711234567, "0.042"] }],
					},
				}),
				{ status: 200 },
			),
		);

		const result = await queryMetrics("rate(http_requests_total[5m])");
		expect(result.resultType).toBe("vector");
		expect(result.result).toHaveLength(1);
		expect(result.result[0].value[1]).toBe("0.042");
	});

	it("throws QueryError when status is not success", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(
			new Response(JSON.stringify({ status: "error", data: { resultType: "vector", result: [] } }), { status: 200 }),
		);

		await expect(queryMetrics("bad")).rejects.toThrow(QueryError);
	});
});

describe("queryLogs", () => {
	it("parses JSON Lines response into array of LogEntry", async () => {
		const ndjson = [
			JSON.stringify({ _msg: "error A", _stream: "{}", _time: "2026-01-01T00:00:00Z" }),
			JSON.stringify({ _msg: "error B", _stream: "{}", _time: "2026-01-01T00:00:01Z" }),
			"",
		].join("\n");

		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response(ndjson, { status: 200 }));

		const entries = await queryLogs('{app="api"} error');
		expect(entries).toHaveLength(2);
		expect(entries[0]._msg).toBe("error A");
	});

	it("returns empty array when response is empty", async () => {
		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response("", { status: 200 }));
		const entries = await queryLogs("*");
		expect(entries).toHaveLength(0);
	});
});

describe("queryTraces", () => {
	it("parses JSON Lines response into array of TraceEntry", async () => {
		const ndjson = [
			JSON.stringify({
				traceID: "abc",
				spanID: "s1",
				operationName: "GET /",
				duration: 42,
				_time: "2026-01-01T00:00:00Z",
			}),
			"",
		].join("\n");

		global.fetch = (vi.fn() as any).mockResolvedValueOnce(new Response(ndjson, { status: 200 }));

		const entries = await queryTraces("*");
		expect(entries).toHaveLength(1);
		expect(entries[0].traceID).toBe("abc");
		expect(entries[0].duration).toBe(42);
	});
});

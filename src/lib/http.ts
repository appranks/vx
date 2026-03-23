import { TIMEOUTS } from "./constants.ts";

export class StackUnreachableError extends Error {
	constructor(url: string, cause?: unknown) {
		super(`victoria backend unreachable at ${url}`);
		this.name = "StackUnreachableError";
		this.cause = cause;
	}
}

export class QueryError extends Error {
	constructor(_query: string, detail: string) {
		super(`invalid query: ${detail}`);
		this.name = "QueryError";
	}
}

export interface MetricSample {
	metric: Record<string, string>;
	value: [number, string];
}

export interface MetricsResponse {
	resultType: "vector" | "matrix" | "scalar" | "string";
	result: MetricSample[];
}

export interface LogEntry {
	_msg: string;
	_stream: string;
	_time: string;
	[key: string]: string;
}

export interface TraceEntry {
	traceID: string;
	spanID: string;
	operationName: string;
	duration: number;
	_time: string;
	[key: string]: unknown;
}

export async function victoriaGet(url: string, timeoutMs = 10_000): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			headers: { Accept: "application/json" },
		});
	} catch (err) {
		throw new StackUnreachableError(url, err);
	}

	if (res.status === 400 || res.status === 422) {
		const body = await res.text();
		throw new QueryError(url, body);
	}

	if (!res.ok) {
		throw new StackUnreachableError(url, `HTTP ${res.status}`);
	}

	return res;
}

export async function queryMetrics(query: string, time?: string): Promise<MetricsResponse> {
	const url = new URL("http://localhost:8428/api/v1/query");
	url.searchParams.set("query", query);
	if (time) url.searchParams.set("time", time);

	const res = await victoriaGet(url.toString(), TIMEOUTS.metrics);
	const body = (await res.json()) as { status: string; data: MetricsResponse };

	if (body.status !== "success") {
		throw new QueryError(query, `victoria returned status: ${body.status}`);
	}

	return body.data;
}

function parseNdjson<T>(text: string, fallback: (line: string) => T): T[] {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			try {
				return JSON.parse(line) as T;
			} catch {
				return fallback(line);
			}
		});
}

export async function queryLogs(query: string, limit = 100): Promise<LogEntry[]> {
	const url = new URL("http://localhost:9428/select/logsql/query");
	url.searchParams.set("query", query);
	url.searchParams.set("limit", String(limit));

	const res = await victoriaGet(url.toString(), TIMEOUTS.logs);
	const text = await res.text();

	return parseNdjson<LogEntry>(text, (line) => ({
		_msg: line,
		_stream: "",
		_time: "",
	}));
}

export async function queryTraces(query: string, limit = 50): Promise<TraceEntry[]> {
	const url = new URL("http://localhost:10428/select/logsql/query");
	url.searchParams.set("query", query);
	url.searchParams.set("limit", String(limit));

	const res = await victoriaGet(url.toString(), TIMEOUTS.traces);
	const text = await res.text();

	return parseNdjson<TraceEntry>(text, (line) => ({
		traceID: "",
		spanID: "",
		operationName: line,
		duration: 0,
		_time: "",
	}));
}

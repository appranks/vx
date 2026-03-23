export interface QueryOutput<T> {
	query: string;
	count: number;
	results: T[];
}

export function formatQueryResult<T>(query: string, results: T[]): QueryOutput<T> {
	return { query, count: results.length, results };
}

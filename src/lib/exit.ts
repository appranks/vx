export const EXIT = {
	OK: 0,
	USER_ERROR: 1,
	STACK_ERROR: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitWith(code: ExitCode): never {
	process.exit(code);
}

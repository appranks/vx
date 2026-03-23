export interface DockerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export function dockerRun(args: string[]): DockerResult {
	const proc = Bun.spawnSync(["docker", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: proc.exitCode ?? 1,
		stdout: new TextDecoder().decode(proc.stdout),
		stderr: new TextDecoder().decode(proc.stderr),
	};
}

export function composeRun(args: string[], composePath: string): DockerResult {
	return dockerRun(["compose", "-f", composePath, ...args]);
}

const steps = [
	{ name: "format", cmd: ["bun", "run", "format"] },
	{ name: "lint", cmd: ["bun", "run", "lint"] },
	{ name: "check", cmd: ["bun", "run", "check"] },
	{ name: "test", cmd: ["bun", "run", "test"] },
	{ name: "build", cmd: ["bun", "run", "build"] },
];

let failed = false;

for (const step of steps) {
	const label = `[${step.name}]`;
	process.stdout.write(`${label} running...\n`);

	const proc = Bun.spawnSync(step.cmd, {
		stdout: "inherit",
		stderr: "inherit",
	});

	if (proc.exitCode !== 0) {
		process.stderr.write(`${label} failed with exit code ${proc.exitCode}\n`);
		failed = true;
		break;
	}

	process.stdout.write(`${label} passed\n`);
}

if (failed) {
	process.stderr.write("\nvalidation failed\n");
	process.exit(1);
}

process.stdout.write("\nall gates passed\n");

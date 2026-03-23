import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPortsAvailable } from "../ports.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("checkPortsAvailable", () => {
	it("resolves when all ports are free", async () => {
		global.fetch = (vi.fn() as any).mockRejectedValue(new Error("ECONNREFUSED"));
		await expect(checkPortsAvailable()).resolves.toBeUndefined();
	});

	it("throws when a port is occupied", async () => {
		global.fetch = (vi.fn() as any).mockImplementation((url: string) => {
			if (url.includes("8428")) {
				return Promise.resolve(new Response("ok", { status: 200 }));
			}
			return Promise.reject(new Error("ECONNREFUSED"));
		});

		await expect(checkPortsAvailable()).rejects.toThrow("ports already in use");
	});
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContainerRestartAction } from "./container-restart-action.js";
import { StatusRefreshService } from "../services/status-refresh-service.js";
import type { RemoteDockerService, RemoteDockerServiceOptions } from "../services/remote-docker-service.js";
import type { KeyRenderer, KeyRenderInput } from "../rendering/key-renderer.js";
import type { RemoteContainerStatus } from "../models/container-status.js";
import type { ContainerActionSettings } from "../models/settings.js";

function makeFakeKeyAction(id: string) {
	return {
		id,
		isKey: () => true,
		setImage: vi.fn().mockResolvedValue(undefined),
	};
}

function makeKeyDown(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ContainerActionSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<ContainerRestartAction["onKeyDown"]>[0];
}

function makeWillAppear(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ContainerActionSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<ContainerRestartAction["onWillAppear"]>[0];
}

describe("ContainerRestartAction", () => {
	let dockerService: RemoteDockerService;
	let renderer: KeyRenderer;
	let refreshService: StatusRefreshService;
	let getContainerStatus: ReturnType<
		typeof vi.fn<(host: string, containerName: string, options?: RemoteDockerServiceOptions) => Promise<RemoteContainerStatus>>
	>;
	let restartContainer: ReturnType<
		typeof vi.fn<(host: string, containerName: string, options?: RemoteDockerServiceOptions) => Promise<RemoteContainerStatus>>
	>;
	let render: ReturnType<typeof vi.fn<(input: KeyRenderInput) => string>>;

	beforeEach(() => {
		vi.useFakeTimers();
		getContainerStatus = vi.fn().mockResolvedValue({ name: "backend", visualStatus: "running", running: true });
		restartContainer = vi.fn();
		render = vi.fn().mockReturnValue("<svg></svg>");
		dockerService = {
			getContainerStatus,
			startContainer: vi.fn(),
			stopContainer: vi.fn(),
			restartContainer,
			getComposeStatus: vi.fn(),
			composeUp: vi.fn(),
			composeDown: vi.fn(),
			composeRestart: vi.fn(),
		};
		renderer = { render };
		refreshService = new StatusRefreshService();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const settings: ContainerActionSettings = { sshHost: "docker-server", containerName: "backend" };

	it("runs docker restart on key press and renders the resulting status", async () => {
		restartContainer.mockResolvedValue({ name: "backend", visualStatus: "restarting", running: true });

		const action = new ContainerRestartAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-1");
		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);

		expect(restartContainer).toHaveBeenCalledWith("docker-server", "backend", { timeoutMs: 10_000 });
		expect(render).toHaveBeenCalledWith(expect.objectContaining({ status: "restarting" }));
	});

	it("shows a working state before the restart completes", async () => {
		let resolveRestart: (status: RemoteContainerStatus) => void = () => undefined;
		restartContainer.mockReturnValue(
			new Promise((resolve) => {
				resolveRestart = resolve;
			}),
		);

		const action = new ContainerRestartAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-2");
		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);

		expect(render).toHaveBeenCalledWith(expect.objectContaining({ status: "working" }));

		resolveRestart({ name: "backend", visualStatus: "running", running: true });
		await vi.advanceTimersByTimeAsync(0);
		expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: "running" }));
	});

	it("does nothing when the container name is not configured", async () => {
		const action = new ContainerRestartAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-3");
		action.onKeyDown(makeKeyDown(keyAction, { sshHost: "docker-server" }));
		await vi.advanceTimersByTimeAsync(0);

		expect(restartContainer).not.toHaveBeenCalled();
	});

	it("blocks a repeated press while a restart is already in flight", async () => {
		let resolveRestart: (status: RemoteContainerStatus) => void = () => undefined;
		restartContainer.mockReturnValue(
			new Promise((resolve) => {
				resolveRestart = resolve;
			}),
		);

		const action = new ContainerRestartAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-4");
		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);
		action.onKeyDown(makeKeyDown(keyAction, settings)); // second press while busy
		await vi.advanceTimersByTimeAsync(0);

		expect(restartContainer).toHaveBeenCalledTimes(1);

		resolveRestart({ name: "backend", visualStatus: "running", running: true });
		await vi.advanceTimersByTimeAsync(0);
	});

	it("logs but does not throw when restartContainer rejects unexpectedly", async () => {
		restartContainer.mockRejectedValue(new Error("boom"));

		const action = new ContainerRestartAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-5");
		expect(() => {
			action.onKeyDown(makeKeyDown(keyAction, settings));
		}).not.toThrow();
		await vi.advanceTimersByTimeAsync(0);
	});

	it("does not race with the periodic status poll for the same instance", async () => {
		restartContainer.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });

		const action = new ContainerRestartAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-6");
		action.onWillAppear(makeWillAppear(keyAction, { ...settings, refreshIntervalSeconds: 2 }));
		await vi.advanceTimersByTimeAsync(0);

		getContainerStatus.mockClear();
		action.onKeyDown(makeKeyDown(keyAction, settings));
		// The periodic tick lands while the restart's own SSH calls are in flight.
		await vi.advanceTimersByTimeAsync(2000);

		expect(restartContainer).toHaveBeenCalledTimes(1);
	});
});

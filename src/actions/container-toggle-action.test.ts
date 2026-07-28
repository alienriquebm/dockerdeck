import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContainerToggleAction } from "./container-toggle-action.js";
import { StatusRefreshService } from "../services/status-refresh-service.js";
import type { RemoteDockerService, RemoteDockerServiceOptions } from "../services/remote-docker-service.js";
import type { KeyRenderer, KeyRenderInput } from "../rendering/key-renderer.js";
import type { RemoteContainerStatus } from "../models/container-status.js";
import type { ContainerToggleSettings } from "../models/settings.js";

function makeFakeKeyAction(id: string) {
	return {
		id,
		isKey: () => true,
		setImage: vi.fn().mockResolvedValue(undefined),
	};
}

function makeKeyDown(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ContainerToggleSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<ContainerToggleAction["onKeyDown"]>[0];
}

function makeWillAppear(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ContainerToggleSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<
		ContainerToggleAction["onWillAppear"]
	>[0];
}

describe("ContainerToggleAction", () => {
	let dockerService: RemoteDockerService;
	let renderer: KeyRenderer;
	let refreshService: StatusRefreshService;
	let getContainerStatus: ReturnType<
		typeof vi.fn<
			(
				host: string,
				containerName: string,
				options?: RemoteDockerServiceOptions,
			) => Promise<RemoteContainerStatus>
		>
	>;
	let startContainer: ReturnType<
		typeof vi.fn<
			(
				host: string,
				containerName: string,
				options?: RemoteDockerServiceOptions,
			) => Promise<RemoteContainerStatus>
		>
	>;
	let stopContainer: ReturnType<
		typeof vi.fn<
			(
				host: string,
				containerName: string,
				options?: RemoteDockerServiceOptions,
			) => Promise<RemoteContainerStatus>
		>
	>;
	let render: ReturnType<typeof vi.fn<(input: KeyRenderInput) => string>>;

	beforeEach(() => {
		vi.useFakeTimers();
		getContainerStatus = vi.fn();
		startContainer = vi.fn();
		stopContainer = vi.fn();
		render = vi.fn().mockReturnValue("<svg></svg>");
		dockerService = {
			getContainerStatus,
			startContainer,
			stopContainer,
			restartContainer: vi.fn(),
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

	const settings: ContainerToggleSettings = { sshHost: "docker-server", containerName: "backend" };

	async function appearAsStopped(
		action: ContainerToggleAction,
		keyAction: ReturnType<typeof makeFakeKeyAction>,
	): Promise<void> {
		getContainerStatus.mockResolvedValue({ name: "backend", visualStatus: "stopped", running: false });
		action.onWillAppear(makeWillAppear(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);
	}

	async function appearAsRunning(
		action: ContainerToggleAction,
		keyAction: ReturnType<typeof makeFakeKeyAction>,
	): Promise<void> {
		getContainerStatus.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });
		action.onWillAppear(makeWillAppear(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);
	}

	it("starts a stopped container immediately, no confirmation needed", async () => {
		startContainer.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-1");
		await appearAsStopped(action, keyAction);

		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);

		expect(startContainer).toHaveBeenCalledWith("docker-server", "backend", {
			timeoutMs: 10_000,
			signal: expect.any(AbortSignal) as AbortSignal,
		});
		expect(stopContainer).not.toHaveBeenCalled();
	});

	it("requires a second press to stop a running container by default", async () => {
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-2");
		await appearAsRunning(action, keyAction);

		action.onKeyDown(makeKeyDown(keyAction, settings)); // first press: arms confirmation
		await vi.advanceTimersByTimeAsync(0);
		expect(stopContainer).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledWith(expect.objectContaining({ subtitle: "PRESS AGAIN" }));

		stopContainer.mockResolvedValue({ name: "backend", visualStatus: "stopped", running: false });
		action.onKeyDown(makeKeyDown(keyAction, settings)); // second press: confirms
		await vi.advanceTimersByTimeAsync(0);
		expect(stopContainer).toHaveBeenCalledWith("docker-server", "backend", {
			timeoutMs: 10_000,
			signal: expect.any(AbortSignal) as AbortSignal,
		});
	});

	it("forgets the armed confirmation after the confirm window elapses", async () => {
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-3");
		await appearAsRunning(action, keyAction);

		action.onKeyDown(makeKeyDown(keyAction, settings)); // arms
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(5000); // confirm window (4s) expires

		action.onKeyDown(makeKeyDown(keyAction, settings)); // should arm again, not confirm
		await vi.advanceTimersByTimeAsync(0);
		expect(stopContainer).not.toHaveBeenCalled();
	});

	it("stops immediately when confirmBeforeStop is disabled", async () => {
		stopContainer.mockResolvedValue({ name: "backend", visualStatus: "stopped", running: false });
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-4");
		const noConfirmSettings: ContainerToggleSettings = { ...settings, confirmBeforeStop: false };
		getContainerStatus.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });
		action.onWillAppear(makeWillAppear(keyAction, noConfirmSettings));
		await vi.advanceTimersByTimeAsync(0);

		action.onKeyDown(makeKeyDown(keyAction, noConfirmSettings));
		await vi.advanceTimersByTimeAsync(0);

		expect(stopContainer).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the SSH host is not configured", async () => {
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-5");
		action.onKeyDown(makeKeyDown(keyAction, { containerName: "backend" }));
		await vi.advanceTimersByTimeAsync(0);

		expect(startContainer).not.toHaveBeenCalled();
		expect(stopContainer).not.toHaveBeenCalled();
	});

	it("blocks a repeated press while a toggle is already in flight", async () => {
		let resolveStart: (status: RemoteContainerStatus) => void = () => undefined;
		startContainer.mockReturnValue(
			new Promise((resolve) => {
				resolveStart = resolve;
			}),
		);
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-6");
		await appearAsStopped(action, keyAction);

		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);
		action.onKeyDown(makeKeyDown(keyAction, settings)); // second press while busy
		await vi.advanceTimersByTimeAsync(0);

		expect(startContainer).toHaveBeenCalledTimes(1);
		resolveStart({ name: "backend", visualStatus: "running", running: true });
		await vi.advanceTimersByTimeAsync(0);
	});

	it("clears the armed confirmation when the action disappears", async () => {
		const action = new ContainerToggleAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-7");
		await appearAsRunning(action, keyAction);

		action.onKeyDown(makeKeyDown(keyAction, settings)); // arms
		await vi.advanceTimersByTimeAsync(0);

		action.onWillDisappear({ action: keyAction } as unknown as Parameters<
			ContainerToggleAction["onWillDisappear"]
		>[0]);

		// Reappearing resets lastStatus (nothing polled yet), so a fresh press
		// with no known status defaults to "not running" -> starts, not stops.
		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);
		expect(stopContainer).not.toHaveBeenCalled();
	});
});

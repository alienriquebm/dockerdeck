import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContainerStatusAction } from "./container-status-action.js";
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

function makeWillAppear(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ContainerActionSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<
		ContainerStatusAction["onWillAppear"]
	>[0];
}

function makeWillDisappear(keyAction: ReturnType<typeof makeFakeKeyAction>) {
	return { action: keyAction } as unknown as Parameters<ContainerStatusAction["onWillDisappear"]>[0];
}

describe("ContainerStatusAction", () => {
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
	let render: ReturnType<typeof vi.fn<(input: KeyRenderInput) => string>>;

	beforeEach(() => {
		vi.useFakeTimers();
		getContainerStatus = vi.fn();
		render = vi.fn().mockReturnValue("<svg></svg>");
		dockerService = {
			getContainerStatus,
			startContainer: vi.fn(),
			stopContainer: vi.fn(),
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

	it("queries status and renders it immediately on appear", async () => {
		const status: RemoteContainerStatus = {
			name: "backend",
			visualStatus: "healthy",
			running: true,
			health: "healthy",
		};
		getContainerStatus.mockResolvedValue(status);

		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-1");
		action.onWillAppear(makeWillAppear(keyAction, { sshHost: "docker-server", containerName: "backend" }));

		await vi.advanceTimersByTimeAsync(0);

		expect(getContainerStatus).toHaveBeenCalledWith("docker-server", "backend", {
			timeoutMs: 10_000,
			signal: expect.any(AbortSignal) as AbortSignal,
		});
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({ title: "backend", status: "healthy", subtitle: "healthy" }),
		);
		expect(keyAction.setImage).toHaveBeenCalledWith("<svg></svg>");
	});

	it("stops polling on disappear", async () => {
		getContainerStatus.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });

		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-2");
		action.onWillAppear(makeWillAppear(keyAction, { sshHost: "docker-server", containerName: "backend" }));
		await vi.advanceTimersByTimeAsync(0);

		action.onWillDisappear(makeWillDisappear(keyAction));
		getContainerStatus.mockClear();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(getContainerStatus).not.toHaveBeenCalled();
	});

	it("shows a setup message and skips SSH when the host alias is missing", async () => {
		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-3");
		action.onWillAppear(makeWillAppear(keyAction, { containerName: "backend" }));

		await vi.advanceTimersByTimeAsync(0);

		expect(getContainerStatus).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledWith(expect.objectContaining({ title: "SETUP", status: "unknown" }));
	});

	it("shows a setup message when the container name is missing", async () => {
		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-4");
		action.onWillAppear(makeWillAppear(keyAction, { sshHost: "docker-server" }));

		await vi.advanceTimersByTimeAsync(0);

		expect(getContainerStatus).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledWith(expect.objectContaining({ title: "SETUP" }));
	});

	it("omits the subtitle when showHealth is disabled", async () => {
		getContainerStatus.mockResolvedValue({
			name: "backend",
			visualStatus: "healthy",
			running: true,
			health: "healthy",
		});

		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-5");
		action.onWillAppear(
			makeWillAppear(keyAction, { sshHost: "docker-server", containerName: "backend", showHealth: false }),
		);

		await vi.advanceTimersByTimeAsync(0);

		const input = render.mock.calls[0]?.[0];
		expect(input).toBeDefined();
		expect(input?.subtitle).toBeUndefined();
	});

	it("omits the footer when showUptime is disabled", async () => {
		getContainerStatus.mockResolvedValue({
			name: "backend",
			visualStatus: "running",
			running: true,
			uptimeSeconds: 3600,
		});

		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-6");
		action.onWillAppear(
			makeWillAppear(keyAction, { sshHost: "docker-server", containerName: "backend", showUptime: false }),
		);

		await vi.advanceTimersByTimeAsync(0);

		const input = render.mock.calls[0]?.[0];
		expect(input).toBeDefined();
		expect(input?.footer).toBeUndefined();
	});

	it("re-queries on the configured refresh interval", async () => {
		getContainerStatus.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });

		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-7");
		action.onWillAppear(
			makeWillAppear(keyAction, {
				sshHost: "docker-server",
				containerName: "backend",
				refreshIntervalSeconds: 2,
			}),
		);
		await vi.advanceTimersByTimeAsync(0);

		getContainerStatus.mockClear();
		await vi.advanceTimersByTimeAsync(2000);
		expect(getContainerStatus).toHaveBeenCalledTimes(1);
	});

	it("restarts the polling interval when settings change", async () => {
		getContainerStatus.mockResolvedValue({ name: "backend", visualStatus: "running", running: true });

		const action = new ContainerStatusAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-8");
		action.onWillAppear(
			makeWillAppear(keyAction, {
				sshHost: "docker-server",
				containerName: "backend",
				refreshIntervalSeconds: 5,
			}),
		);
		await vi.advanceTimersByTimeAsync(0);

		action.onDidReceiveSettings(
			makeWillAppear(keyAction, {
				sshHost: "docker-server",
				containerName: "backend-2",
				refreshIntervalSeconds: 5,
			}) as unknown as Parameters<ContainerStatusAction["onDidReceiveSettings"]>[0],
		);
		await vi.advanceTimersByTimeAsync(0);

		getContainerStatus.mockClear();
		await vi.advanceTimersByTimeAsync(5000);
		// A single interval firing once confirms the old timer was replaced, not stacked.
		expect(getContainerStatus).toHaveBeenCalledTimes(1);
		expect(getContainerStatus).toHaveBeenCalledWith("docker-server", "backend-2", expect.anything());
	});
});

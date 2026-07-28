import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ComposeStackAction } from "./compose-stack-action.js";
import { StatusRefreshService } from "../services/status-refresh-service.js";
import type { ComposeOptions, RemoteDockerService } from "../services/remote-docker-service.js";
import type { KeyRenderer, KeyRenderInput } from "../rendering/key-renderer.js";
import type { RemoteComposeStatus } from "../models/compose-status.js";
import type { ComposeActionSettings } from "../models/settings.js";

function makeFakeKeyAction(id: string) {
	return {
		id,
		isKey: () => true,
		setImage: vi.fn().mockResolvedValue(undefined),
	};
}

function makeWillAppear(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ComposeActionSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<ComposeStackAction["onWillAppear"]>[0];
}

function makeKeyDown(keyAction: ReturnType<typeof makeFakeKeyAction>, settings: ComposeActionSettings) {
	return { action: keyAction, payload: { settings } } as unknown as Parameters<ComposeStackAction["onKeyDown"]>[0];
}

type ComposeFn = (host: string, composePath: string, options?: ComposeOptions) => Promise<RemoteComposeStatus>;

describe("ComposeStackAction", () => {
	let dockerService: RemoteDockerService;
	let renderer: KeyRenderer;
	let refreshService: StatusRefreshService;
	let getComposeStatus: ReturnType<typeof vi.fn<ComposeFn>>;
	let composeUp: ReturnType<typeof vi.fn<ComposeFn>>;
	let composeDown: ReturnType<typeof vi.fn<ComposeFn>>;
	let composeRestart: ReturnType<typeof vi.fn<ComposeFn>>;
	let render: ReturnType<typeof vi.fn<(input: KeyRenderInput) => string>>;

	beforeEach(() => {
		vi.useFakeTimers();
		getComposeStatus = vi.fn();
		composeUp = vi.fn();
		composeDown = vi.fn();
		composeRestart = vi.fn();
		render = vi.fn().mockReturnValue("<svg></svg>");
		dockerService = {
			getContainerStatus: vi.fn(),
			startContainer: vi.fn(),
			stopContainer: vi.fn(),
			restartContainer: vi.fn(),
			getComposeStatus,
			composeUp,
			composeDown,
			composeRestart,
		};
		renderer = { render };
		refreshService = new StatusRefreshService();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const settings: ComposeActionSettings = { sshHost: "docker-server", composePath: "/srv/app" };

	function statusOf(overrides: Partial<RemoteComposeStatus> = {}): RemoteComposeStatus {
		return {
			composePath: "/srv/app",
			visualStatus: "up",
			services: [],
			runningCount: 2,
			totalCount: 2,
			...overrides,
		};
	}

	it("queries status and renders it immediately on appear", async () => {
		getComposeStatus.mockResolvedValue(statusOf());
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-1");
		action.onWillAppear(makeWillAppear(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);

		expect(getComposeStatus).toHaveBeenCalledWith("docker-server", "/srv/app", {
			timeoutMs: 10_000,
			signal: expect.any(AbortSignal) as AbortSignal,
		});
		expect(render).toHaveBeenCalledWith(expect.objectContaining({ status: "up", subtitle: "2/2 running" }));
	});

	it("uses the compose path's basename as the title when no project name is set", async () => {
		getComposeStatus.mockResolvedValue(statusOf());
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-2");
		action.onWillAppear(makeWillAppear(keyAction, { sshHost: "docker-server", composePath: "/srv/sample-stack" }));
		await vi.advanceTimersByTimeAsync(0);

		expect(render).toHaveBeenCalledWith(expect.objectContaining({ title: "sample-stack" }));
	});

	it("prefers the configured project name as the title", async () => {
		getComposeStatus.mockResolvedValue(statusOf());
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-3");
		action.onWillAppear(makeWillAppear(keyAction, { ...settings, projectName: "my-stack" }));
		await vi.advanceTimersByTimeAsync(0);

		expect(render).toHaveBeenCalledWith(expect.objectContaining({ title: "my-stack" }));
		const [, , remoteOptions] = getComposeStatus.mock.calls[0] as [string, string, ComposeOptions];
		expect(remoteOptions).toMatchObject({ projectName: "my-stack" });
	});

	it("shows a setup message when the compose path is missing", async () => {
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-4");
		action.onWillAppear(makeWillAppear(keyAction, { sshHost: "docker-server" }));
		await vi.advanceTimersByTimeAsync(0);

		expect(getComposeStatus).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledWith(expect.objectContaining({ title: "SETUP" }));
	});

	it("stops polling on disappear", async () => {
		getComposeStatus.mockResolvedValue(statusOf());
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-5");
		action.onWillAppear(makeWillAppear(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);

		action.onWillDisappear({ action: keyAction } as unknown as Parameters<
			ComposeStackAction["onWillDisappear"]
		>[0]);
		getComposeStatus.mockClear();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(getComposeStatus).not.toHaveBeenCalled();
	});

	describe("operation: toggle (default)", () => {
		it("brings the stack up when it is currently down", async () => {
			getComposeStatus.mockResolvedValue(statusOf({ visualStatus: "down", runningCount: 0 }));
			composeUp.mockResolvedValue(statusOf({ visualStatus: "up" }));
			const action = new ComposeStackAction(dockerService, renderer, refreshService);
			const keyAction = makeFakeKeyAction("ctx-6");
			action.onWillAppear(makeWillAppear(keyAction, settings));
			await vi.advanceTimersByTimeAsync(0);

			action.onKeyDown(makeKeyDown(keyAction, settings));
			await vi.advanceTimersByTimeAsync(0);

			expect(composeUp).toHaveBeenCalledWith("docker-server", "/srv/app", {
				timeoutMs: 10_000,
				signal: expect.any(AbortSignal) as AbortSignal,
			});
			expect(composeDown).not.toHaveBeenCalled();
		});

		it("tears the stack down when it is currently fully up", async () => {
			getComposeStatus.mockResolvedValue(statusOf({ visualStatus: "up" }));
			composeDown.mockResolvedValue(statusOf({ visualStatus: "down", runningCount: 0 }));
			const action = new ComposeStackAction(dockerService, renderer, refreshService);
			const keyAction = makeFakeKeyAction("ctx-7");
			action.onWillAppear(makeWillAppear(keyAction, settings));
			await vi.advanceTimersByTimeAsync(0);

			action.onKeyDown(makeKeyDown(keyAction, settings));
			await vi.advanceTimersByTimeAsync(0);

			expect(composeDown).toHaveBeenCalledWith("docker-server", "/srv/app", {
				timeoutMs: 10_000,
				signal: expect.any(AbortSignal) as AbortSignal,
			});
			expect(composeUp).not.toHaveBeenCalled();
		});

		it("brings the stack up when it is currently only partially up", async () => {
			getComposeStatus.mockResolvedValue(statusOf({ visualStatus: "partial", runningCount: 1 }));
			composeUp.mockResolvedValue(statusOf({ visualStatus: "up" }));
			const action = new ComposeStackAction(dockerService, renderer, refreshService);
			const keyAction = makeFakeKeyAction("ctx-8");
			action.onWillAppear(makeWillAppear(keyAction, settings));
			await vi.advanceTimersByTimeAsync(0);

			action.onKeyDown(makeKeyDown(keyAction, settings));
			await vi.advanceTimersByTimeAsync(0);

			expect(composeUp).toHaveBeenCalledTimes(1);
		});
	});

	it("operation 'up' always runs composeUp regardless of current state", async () => {
		getComposeStatus.mockResolvedValue(statusOf({ visualStatus: "up" }));
		composeUp.mockResolvedValue(statusOf({ visualStatus: "up" }));
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-9");
		const upSettings: ComposeActionSettings = { ...settings, operation: "up" };
		action.onWillAppear(makeWillAppear(keyAction, upSettings));
		await vi.advanceTimersByTimeAsync(0);

		action.onKeyDown(makeKeyDown(keyAction, upSettings));
		await vi.advanceTimersByTimeAsync(0);

		expect(composeUp).toHaveBeenCalledTimes(1);
	});

	it("operation 'down' always runs composeDown", async () => {
		composeDown.mockResolvedValue(statusOf({ visualStatus: "down", runningCount: 0 }));
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-10");
		const downSettings: ComposeActionSettings = { ...settings, operation: "down" };
		action.onKeyDown(makeKeyDown(keyAction, downSettings));
		await vi.advanceTimersByTimeAsync(0);

		expect(composeDown).toHaveBeenCalledWith("docker-server", "/srv/app", {
			timeoutMs: 10_000,
			signal: expect.any(AbortSignal) as AbortSignal,
		});
	});

	it("operation 'restart' always runs composeRestart", async () => {
		composeRestart.mockResolvedValue(statusOf({ visualStatus: "up" }));
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-11");
		const restartSettings: ComposeActionSettings = { ...settings, operation: "restart" };
		action.onKeyDown(makeKeyDown(keyAction, restartSettings));
		await vi.advanceTimersByTimeAsync(0);

		expect(composeRestart).toHaveBeenCalledWith("docker-server", "/srv/app", {
			timeoutMs: 10_000,
			signal: expect.any(AbortSignal) as AbortSignal,
		});
	});

	it("blocks a repeated press while an operation is already in flight", async () => {
		let resolveUp: (status: RemoteComposeStatus) => void = () => undefined;
		composeUp.mockReturnValue(
			new Promise((resolve) => {
				resolveUp = resolve;
			}),
		);
		getComposeStatus.mockResolvedValue(statusOf({ visualStatus: "down", runningCount: 0 }));
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-12");
		action.onWillAppear(makeWillAppear(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);

		action.onKeyDown(makeKeyDown(keyAction, settings));
		await vi.advanceTimersByTimeAsync(0);
		action.onKeyDown(makeKeyDown(keyAction, settings)); // second press while busy
		await vi.advanceTimersByTimeAsync(0);

		expect(composeUp).toHaveBeenCalledTimes(1);
		resolveUp(statusOf({ visualStatus: "up" }));
		await vi.advanceTimersByTimeAsync(0);
	});

	it("does nothing on key press when not configured", async () => {
		const action = new ComposeStackAction(dockerService, renderer, refreshService);
		const keyAction = makeFakeKeyAction("ctx-13");
		action.onKeyDown(makeKeyDown(keyAction, {}));
		await vi.advanceTimersByTimeAsync(0);

		expect(composeUp).not.toHaveBeenCalled();
		expect(composeDown).not.toHaveBeenCalled();
		expect(composeRestart).not.toHaveBeenCalled();
	});
});

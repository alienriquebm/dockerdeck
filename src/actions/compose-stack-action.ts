/**
 * Docker Compose Stack — shows and controls a whole compose project.
 * Its key press behavior depends on the configured `operation`: toggle
 * (bring everything up unless it's already fully up, in which case tear it
 * down), or a fixed up/down/restart.
 */

import streamDeck, {
	action,
	SingletonAction,
	type DialAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { RemoteComposeStatus } from "../models/compose-status.js";
import {
	resolveRefreshIntervalSeconds,
	resolveSshTimeoutSeconds,
	type ComposeActionSettings,
} from "../models/settings.js";
import { keyRenderer, type KeyRenderer, type KeyRenderInput } from "../rendering/key-renderer.js";
import {
	remoteDockerService,
	type ComposeOptions,
	type RemoteDockerService,
} from "../services/remote-docker-service.js";
import { statusRefreshService, StatusRefreshService } from "../services/status-refresh-service.js";
import { validateComposePath, validateSshHost } from "../utils/validation.js";

const logger = streamDeck.logger.createScope("ComposeStackAction");

function composePathBasename(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const lastSlash = trimmed.lastIndexOf("/");
	return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

// @ts-expect-error TS1238: SDK's .d.ts targets native TC39 decorators; this project uses
// experimentalDecorators (required for Vitest's esbuild transform to parse @action(...) at
// all — see AGENTS.md's "Known, accepted quirks"). Compiled output is correct either way.
@action({ UUID: "com.alienriquebm.dockerdeck.compose-stack" })
export class ComposeStackAction extends SingletonAction<ComposeActionSettings> {
	private readonly lastStatus = new Map<string, RemoteComposeStatus>();

	constructor(
		private readonly dockerService: RemoteDockerService = remoteDockerService,
		private readonly renderer: KeyRenderer = keyRenderer,
		private readonly refreshService: StatusRefreshService = statusRefreshService,
	) {
		super();
	}

	override onWillAppear(ev: WillAppearEvent<ComposeActionSettings>): void {
		this.restart(ev.action, ev.payload.settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ComposeActionSettings>): void {
		this.restart(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<ComposeActionSettings>): void {
		this.refreshService.stop(ev.action.id);
		this.lastStatus.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<ComposeActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const keyAction = ev.action;
		const settings = ev.payload.settings;
		// Routed through refreshService so an operation in flight both blocks a
		// repeated press AND the periodic status poll from racing it.
		this.refreshService.refreshNow(keyAction.id, (isCurrent, signal) =>
			this.handlePress(keyAction, settings, isCurrent, signal),
		);
	}

	private restart(
		source: DialAction<ComposeActionSettings> | KeyAction<ComposeActionSettings>,
		settings: ComposeActionSettings,
	): void {
		if (!source.isKey()) {
			return;
		}
		const keyAction = source;
		const intervalSeconds = resolveRefreshIntervalSeconds(settings.refreshIntervalSeconds);
		this.refreshService.start(keyAction.id, intervalSeconds, (isCurrent, signal) =>
			this.refresh(keyAction, settings, isCurrent, signal),
		);
	}

	private async refresh(
		keyAction: KeyAction<ComposeActionSettings>,
		settings: ComposeActionSettings,
		isCurrent: () => boolean,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const hostCheck = validateSshHost(settings.sshHost);
			if (!hostCheck.valid) {
				await this.renderIssue(keyAction, settings, hostCheck.message);
				return;
			}
			const pathCheck = validateComposePath(settings.composePath);
			if (!pathCheck.valid) {
				await this.renderIssue(keyAction, settings, pathCheck.message);
				return;
			}

			const sshHost = settings.sshHost as string;
			const composePath = settings.composePath as string;
			const status = await this.dockerService.getComposeStatus(
				sshHost,
				composePath,
				this.composeOptions(settings, signal),
			);

			if (!isCurrent()) {
				return;
			}

			this.lastStatus.set(keyAction.id, status);
			if (status.errorMessage !== undefined) {
				logger.warn(`${composePath}@${sshHost}: ${status.visualStatus} — ${status.errorMessage}`);
			}
			await this.render(keyAction, settings, status);
		} catch (error) {
			logger.error(
				"Unexpected failure while refreshing the compose stack face",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private async handlePress(
		keyAction: KeyAction<ComposeActionSettings>,
		settings: ComposeActionSettings,
		isCurrent: () => boolean,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const hostCheck = validateSshHost(settings.sshHost);
			const pathCheck = validateComposePath(settings.composePath);
			if (!hostCheck.valid || !pathCheck.valid) {
				return;
			}

			const id = keyAction.id;
			const sshHost = settings.sshHost as string;
			const composePath = settings.composePath as string;
			const options = this.composeOptions(settings, signal);
			const operation = settings.operation ?? "toggle";

			await this.renderWorking(keyAction, settings);

			let status: RemoteComposeStatus;
			switch (operation) {
				case "up":
					status = await this.dockerService.composeUp(sshHost, composePath, options);
					break;
				case "down":
					status = await this.dockerService.composeDown(sshHost, composePath, options);
					break;
				case "restart":
					status = await this.dockerService.composeRestart(sshHost, composePath, options);
					break;
				case "toggle":
				default: {
					const isUp = this.lastStatus.get(id)?.visualStatus === "up";
					status = isUp
						? await this.dockerService.composeDown(sshHost, composePath, options)
						: await this.dockerService.composeUp(sshHost, composePath, options);
					break;
				}
			}

			if (!isCurrent()) {
				return;
			}

			this.lastStatus.set(id, status);
			if (status.errorMessage !== undefined) {
				logger.warn(
					`${composePath}@${sshHost}: ${operation} -> ${status.visualStatus} — ${status.errorMessage}`,
				);
			}
			await this.render(keyAction, settings, status);
		} catch (error) {
			logger.error(
				"Unexpected failure while operating the compose stack",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private composeOptions(settings: ComposeActionSettings, signal: AbortSignal): ComposeOptions {
		const options: ComposeOptions = {
			timeoutMs: resolveSshTimeoutSeconds(settings.sshTimeoutSeconds) * 1000,
			signal,
		};
		if (settings.projectName !== undefined && settings.projectName !== "") {
			options.projectName = settings.projectName;
		}
		return options;
	}

	private titleFor(settings: ComposeActionSettings): string {
		if (settings.projectName !== undefined && settings.projectName !== "") {
			return settings.projectName;
		}
		return composePathBasename(settings.composePath ?? "");
	}

	private async render(
		keyAction: KeyAction<ComposeActionSettings>,
		settings: ComposeActionSettings,
		status: RemoteComposeStatus,
	): Promise<void> {
		const input: KeyRenderInput = { title: this.titleFor(settings), status: status.visualStatus, icon: "stack" };
		if (status.totalCount > 0) {
			input.subtitle = `${status.runningCount.toString()}/${status.totalCount.toString()} running`;
		}
		await keyAction.setImage(this.renderer.render(input));
	}

	private async renderIssue(
		keyAction: KeyAction<ComposeActionSettings>,
		settings: ComposeActionSettings,
		message: string,
	): Promise<void> {
		const title =
			settings.composePath !== undefined && settings.composePath !== "" ? this.titleFor(settings) : "SETUP";
		const input: KeyRenderInput = { title, status: "unknown", icon: "stack", subtitle: message };
		await keyAction.setImage(this.renderer.render(input));
	}

	private async renderWorking(
		keyAction: KeyAction<ComposeActionSettings>,
		settings: ComposeActionSettings,
	): Promise<void> {
		const input: KeyRenderInput = { title: this.titleFor(settings), status: "working", icon: "stack" };
		await keyAction.setImage(this.renderer.render(input));
	}
}

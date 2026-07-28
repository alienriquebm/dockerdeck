/**
 * BaseContainerAction — shared polling/render/validate lifecycle for every
 * action that shows a single container's status (Status, Toggle, Restart).
 *
 * Subclasses only need to declare their action-type icon and, if they can
 * trigger operations, implement `onKeyDown` themselves (typically by routing
 * through `refreshService.refreshNow`, which reuses the same in-flight guard
 * that already protects the periodic loop — see ContainerToggleAction and
 * ContainerRestartAction).
 */

import streamDeck, {
	SingletonAction,
	type DialAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { RemoteContainerStatus } from "../models/container-status.js";
import { resolveRefreshIntervalSeconds, resolveSshTimeoutSeconds, type ContainerActionSettings } from "../models/settings.js";
import { keyRenderer, type ActionIconKind, type KeyRenderer, type KeyRenderInput } from "../rendering/key-renderer.js";
import { remoteDockerService, type RemoteDockerService } from "../services/remote-docker-service.js";
import { statusRefreshService, StatusRefreshService } from "../services/status-refresh-service.js";
import { formatDuration } from "../utils/duration.js";
import { validateContainerName, validateSshHost } from "../utils/validation.js";

export abstract class BaseContainerAction<TSettings extends ContainerActionSettings> extends SingletonAction<TSettings> {
	protected readonly logger = streamDeck.logger.createScope(this.constructor.name);

	/** Last known status per instance id, kept fresh by every successful refresh. Used by subclasses to decide start-vs-stop, etc. */
	protected readonly lastStatus = new Map<string, RemoteContainerStatus>();

	constructor(
		protected readonly dockerService: RemoteDockerService = remoteDockerService,
		protected readonly renderer: KeyRenderer = keyRenderer,
		protected readonly refreshService: StatusRefreshService = statusRefreshService,
	) {
		super();
	}

	/** The glyph drawn at the bottom of every key belonging to this action. */
	protected abstract readonly icon: ActionIconKind;

	override onWillAppear(ev: WillAppearEvent<TSettings>): void {
		this.restart(ev.action, ev.payload.settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TSettings>): void {
		this.restart(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<TSettings>): void {
		this.refreshService.stop(ev.action.id);
		this.lastStatus.delete(ev.action.id);
	}

	protected restart(source: DialAction<TSettings> | KeyAction<TSettings>, settings: TSettings): void {
		// Stream Deck+ dials are not supported yet; only standard keys render a status face.
		if (!source.isKey()) {
			return;
		}
		const keyAction = source;
		const intervalSeconds = resolveRefreshIntervalSeconds(settings.refreshIntervalSeconds);
		this.refreshService.start(keyAction.id, intervalSeconds, (isCurrent) => this.refresh(keyAction, settings, isCurrent));
	}

	protected async refresh(keyAction: KeyAction<TSettings>, settings: TSettings, isCurrent: () => boolean): Promise<void> {
		try {
			const hostCheck = validateSshHost(settings.sshHost);
			if (!hostCheck.valid) {
				await this.renderIssue(keyAction, hostCheck.message);
				return;
			}
			const nameCheck = validateContainerName(settings.containerName);
			if (!nameCheck.valid) {
				await this.renderIssue(keyAction, nameCheck.message);
				return;
			}

			const sshHost = settings.sshHost as string;
			const containerName = settings.containerName as string;
			const timeoutMs = resolveSshTimeoutSeconds(settings.sshTimeoutSeconds) * 1000;

			const status = await this.dockerService.getContainerStatus(sshHost, containerName, { timeoutMs });

			// A newer refresh (triggered by settings changing, the action
			// reappearing, or a manual operation) may have already superseded this
			// one while the SSH call was in flight. Discard this stale result
			// rather than clobber it.
			if (!isCurrent()) {
				return;
			}

			this.lastStatus.set(keyAction.id, status);

			if (status.errorMessage !== undefined) {
				this.logger.warn(`${containerName}@${sshHost}: ${status.visualStatus} — ${status.errorMessage}`);
			}

			await this.renderStatus(keyAction, containerName, status, settings);
		} catch (error) {
			// StatusRefreshService swallows rejections from this task to keep the
			// polling loop alive; log here so a rendering/SDK-level failure is
			// still visible instead of vanishing silently.
			this.logger.error("Unexpected failure while refreshing the key face", error instanceof Error ? error.message : String(error));
		}
	}

	protected async renderStatus(
		keyAction: KeyAction<TSettings>,
		containerName: string,
		status: RemoteContainerStatus,
		settings: ContainerActionSettings,
	): Promise<void> {
		const showHealth = settings.showHealth ?? true;
		const showUptime = settings.showUptime ?? true;

		const input: KeyRenderInput = { title: containerName, status: status.visualStatus, icon: this.icon };
		if (showHealth && status.health !== undefined) {
			input.subtitle = status.health;
		}
		if (showUptime && status.uptimeSeconds !== undefined) {
			input.footer = formatDuration(status.uptimeSeconds);
		}

		await keyAction.setImage(this.renderer.render(input));
	}

	protected async renderIssue(keyAction: KeyAction<TSettings>, message: string): Promise<void> {
		const input: KeyRenderInput = { title: "SETUP", status: "unknown", icon: this.icon, subtitle: message };
		await keyAction.setImage(this.renderer.render(input));
	}

	protected async renderWorking(keyAction: KeyAction<TSettings>, containerName: string, subtitle?: string): Promise<void> {
		const input: KeyRenderInput = { title: containerName, status: "working", icon: this.icon };
		if (subtitle !== undefined) {
			input.subtitle = subtitle;
		}
		await keyAction.setImage(this.renderer.render(input));
	}
}

/**
 * Container Restart — issues `docker restart` on press and shows a
 * "working" state while it runs.
 */

import { action, type KeyAction, type KeyDownEvent } from "@elgato/streamdeck";

import { BaseContainerAction } from "./base-container-action.js";
import type { ActionIconKind } from "../rendering/key-renderer.js";
import { resolveSshTimeoutSeconds, type ContainerActionSettings } from "../models/settings.js";
import { validateContainerName, validateSshHost } from "../utils/validation.js";

// @ts-expect-error TS1238: SDK's .d.ts targets native TC39 decorators; this project uses
// experimentalDecorators (required for Vitest's esbuild transform to parse @action(...) at
// all — see AGENTS.md's "Known, accepted quirks"). Compiled output is correct either way.
@action({ UUID: "com.alienriquebm.dockerdeck.container-restart" })
export class ContainerRestartAction extends BaseContainerAction<ContainerActionSettings> {
	protected readonly icon: ActionIconKind = "restart";

	override onKeyDown(ev: KeyDownEvent<ContainerActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const keyAction = ev.action;
		const settings = ev.payload.settings;
		// Routed through refreshService so a restart in flight both blocks a
		// repeated press AND the periodic status poll from racing it — the same
		// in-flight guard already protects the polling loop.
		this.refreshService.refreshNow(keyAction.id, (isCurrent, signal) =>
			this.performRestart(keyAction, settings, isCurrent, signal),
		);
	}

	private async performRestart(
		keyAction: KeyAction<ContainerActionSettings>,
		settings: ContainerActionSettings,
		isCurrent: () => boolean,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const hostCheck = validateSshHost(settings.sshHost);
			const nameCheck = validateContainerName(settings.containerName);
			if (!hostCheck.valid || !nameCheck.valid) {
				// The status face (from the polling loop) already shows the
				// configuration issue; nothing sensible to restart yet.
				return;
			}

			const sshHost = settings.sshHost as string;
			const containerName = settings.containerName as string;
			const timeoutMs = resolveSshTimeoutSeconds(settings.sshTimeoutSeconds) * 1000;

			await this.renderWorking(keyAction, containerName);
			const status = await this.dockerService.restartContainer(sshHost, containerName, { timeoutMs, signal });

			if (!isCurrent()) {
				return;
			}

			this.lastStatus.set(keyAction.id, status);
			if (status.errorMessage !== undefined) {
				this.logger.warn(
					`${containerName}@${sshHost}: restart -> ${status.visualStatus} — ${status.errorMessage}`,
				);
			}
			await this.renderStatus(keyAction, containerName, status, settings);
		} catch (error) {
			this.logger.error(
				"Unexpected failure while restarting the container",
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}

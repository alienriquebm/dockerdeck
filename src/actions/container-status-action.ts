/**
 * Container Status — read-only key that shows a container's live state.
 * Never issues start/stop/restart.
 */

import { action } from "@elgato/streamdeck";

import { BaseContainerAction } from "./base-container-action.js";
import type { ActionIconKind } from "../rendering/key-renderer.js";
import type { ContainerActionSettings } from "../models/settings.js";

@action({ UUID: "com.alienriquebm.dockerdeck.container-status" })
export class ContainerStatusAction extends BaseContainerAction<ContainerActionSettings> {
	protected readonly icon: ActionIconKind = "container";
}

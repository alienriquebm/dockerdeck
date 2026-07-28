import streamDeck from "@elgato/streamdeck";

import { ContainerStatusAction } from "./actions/container-status-action.js";
import { ContainerToggleAction } from "./actions/container-toggle-action.js";
import { ContainerRestartAction } from "./actions/container-restart-action.js";
import { ComposeStackAction } from "./actions/compose-stack-action.js";

streamDeck.logger.setLevel("debug");

streamDeck.actions.registerAction(new ContainerStatusAction());
streamDeck.actions.registerAction(new ContainerToggleAction());
streamDeck.actions.registerAction(new ContainerRestartAction());
streamDeck.actions.registerAction(new ComposeStackAction());

void streamDeck.connect();

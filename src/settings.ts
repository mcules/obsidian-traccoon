import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type TraccoonPlugin from "./main";

export type ContextMode = "path_and_selection" | "path_only" | "off";

export interface TraccoonSettings {
  baseUrl: string;
  /**
   * Personal access token (`trc_…`), created in Traccoon under Settings → Personal.
   * A password is deliberately not part of this plugin: a token can be revoked on its own,
   * a password cannot.
   */
  token: string;
  contextMode: ContextMode;
  ticketProjectId: number | null;
  liveEvents: boolean;
  pollIntervalMs: number;
  /** The session the chat was last in, so reopening the view lands where you left. */
  lastSessionId: number | null;
  /**
   * Unsent text per conversation, keyed by session id ("none" before the first one exists.)
   * Written while typing so that a crash, a restart or an unreachable server cannot take a
   * message that was never sent.
   */
  drafts: Record<string, string>;
}

export const DEFAULT_SETTINGS: TraccoonSettings = {
  baseUrl: "",
  token: "",
  contextMode: "path_and_selection",
  ticketProjectId: null,
  liveEvents: true,
  pollIntervalMs: 3000,
  lastSessionId: null,
  drafts: {},
};

export class TraccoonSettingTab extends PluginSettingTab {
  plugin: TraccoonPlugin;

  constructor(app: App, plugin: TraccoonPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Server")
      .setDesc("Base URL of the Traccoon frontend, e.g. https://traccoon.example.com (no /api).")
      .addText((t) =>
        t
          .setPlaceholder("https://traccoon.example.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
            this.plugin.reconnect();
          }),
      );

    new Setting(containerEl)
      .setName("Access token")
      .setDesc(
        "Traccoon → Settings → Personal → Access tokens. Scopes: 'assistant' for the chat, " +
          "'tickets' additionally for creating tickets from a note.",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.inputEl.classList.add("traccoon-wide-input");
        t.setPlaceholder("trc_…")
          .setValue(this.plugin.settings.token)
          .onChange(async (v) => {
            this.plugin.settings.token = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnect();
          });
      });

    new Setting(containerEl)
      .setName("Connection")
      .setDesc("Asks the server who this token belongs to.")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          try {
            const me = await this.plugin.api.me();
            new Notice(`Traccoon: connected as ${me.username || me.email}`);
          } catch (e) {
            new Notice(`Traccoon: ${(e as Error).message}`);
          }
        }),
      )
      .addButton((b) =>
        b.setButtonText("Forget token").onClick(async () => {
          this.plugin.settings.token = "";
          await this.plugin.saveSettings();
          this.plugin.reconnect();
          this.display();
        }),
      );

    containerEl.createEl("p", {
      cls: "traccoon-warn",
      text:
        "The token is stored in plain text in .obsidian/plugins/traccoon-assistant/data.json, " +
        "which travels with every vault sync. Give this token only the scopes it needs, and " +
        "revoke it in Traccoon when a device is lost — that works without touching your password.",
    });

    containerEl.createEl("h3", { text: "Chat" });

    new Setting(containerEl)
      .setName("Send context from the editor")
      .setDesc("What gets appended to a message you send from a note.")
      .addDropdown((d) =>
        d
          .addOption("path_and_selection", "Note path + selection")
          .addOption("path_only", "Note path only")
          .addOption("off", "Nothing")
          .setValue(this.plugin.settings.contextMode)
          .onChange(async (v) => {
            this.plugin.settings.contextMode = v as ContextMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Live agent events")
      .setDesc("Stream tool calls and agent output over the office websocket while a run is active.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.liveEvents).onChange(async (v) => {
          this.plugin.settings.liveEvents = v;
          await this.plugin.saveSettings();
          this.plugin.reconnect();
        }),
      );

    new Setting(containerEl)
      .setName("Refresh interval while a run is active (ms)")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.pollIntervalMs)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1000) {
            this.plugin.settings.pollIntervalMs = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    containerEl.createEl("h3", { text: "Tickets" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Needs a token with the 'tickets' scope. Without it the chat still works.",
    });

    new Setting(containerEl)
      .setName("Default project")
      .setDesc("Project a ticket goes into when you create one from a note.")
      .addDropdown(async (d) => {
        d.addOption("", "— none —");
        try {
          const projects = await this.plugin.api.projects();
          for (const p of projects) d.addOption(String(p.id), `${p.key} — ${p.name}`);
        } catch {
          // No token, no scope, or no server: the dropdown stays empty instead of shouting.
        }
        d.setValue(
          this.plugin.settings.ticketProjectId ? String(this.plugin.settings.ticketProjectId) : "",
        );
        d.onChange(async (v) => {
          this.plugin.settings.ticketProjectId = v ? Number(v) : null;
          await this.plugin.saveSettings();
        });
      });
  }
}

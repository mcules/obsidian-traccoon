import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type TraccoonPlugin from "./main";

export type ContextMode = "path_and_selection" | "path_only" | "off";

export interface TraccoonSettings {
  baseUrl: string;
  email: string;
  /** JWT from POST /auth/login. Stored in data.json — see the warning in the settings tab. */
  token: string;
  contextMode: ContextMode;
  ticketProjectId: number | null;
  liveEvents: boolean;
  pollIntervalMs: number;
}

export const DEFAULT_SETTINGS: TraccoonSettings = {
  baseUrl: "",
  email: "",
  token: "",
  contextMode: "path_and_selection",
  ticketProjectId: null,
  liveEvents: true,
  pollIntervalMs: 3000,
};

export class TraccoonSettingTab extends PluginSettingTab {
  plugin: TraccoonPlugin;
  private password = "";

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
          }),
      );

    new Setting(containerEl)
      .setName("E-Mail")
      .addText((t) =>
        t
          .setPlaceholder("you@example.com")
          .setValue(this.plugin.settings.email)
          .onChange(async (v) => {
            this.plugin.settings.email = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Password")
      .setDesc(
        "Used once to fetch a token. The password itself is never stored; the token is kept in this plugin's data.json.",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("••••••••").onChange((v) => (this.password = v));
      })
      .addButton((b) =>
        b
          .setButtonText("Log in")
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.api.login(this.plugin.settings.email, this.password);
              this.password = "";
              new Notice("Traccoon: logged in");
              this.display();
            } catch (e) {
              new Notice(`Traccoon login failed: ${(e as Error).message}`);
            }
          }),
      );

    const status = this.plugin.settings.token ? "token present" : "not logged in";
    new Setting(containerEl)
      .setName("Session")
      .setDesc(status)
      .addButton((b) =>
        b.setButtonText("Log out").onClick(async () => {
          this.plugin.settings.token = "";
          await this.plugin.saveSettings();
          this.plugin.reconnect();
          this.display();
        }),
      );

    containerEl.createEl("p", {
      cls: "traccoon-warn",
      text:
        "The access token is stored in plain text in .obsidian/plugins/traccoon-assistant/data.json. " +
        "That file travels with every vault sync — treat every synced machine as holding a valid Traccoon session.",
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

    new Setting(containerEl)
      .setName("Default project")
      .setDesc("Project a ticket goes into when you create one from a note.")
      .addDropdown(async (d) => {
        d.addOption("", "— none —");
        try {
          const projects = await this.plugin.api.projects();
          for (const p of projects) d.addOption(String(p.id), `${p.key} — ${p.name}`);
        } catch {
          /* offline or not logged in: the dropdown stays empty */
        }
        d.setValue(this.plugin.settings.ticketProjectId ? String(this.plugin.settings.ticketProjectId) : "");
        d.onChange(async (v) => {
          this.plugin.settings.ticketProjectId = v ? Number(v) : null;
          await this.plugin.saveSettings();
        });
      });
  }
}

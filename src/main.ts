import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, TraccoonSettingTab, TraccoonSettings } from "./settings";
import { TraccoonApi } from "./api";
import { OfficeSocket } from "./ws";
import { TraccoonChatView, VIEW_TYPE_TRACCOON } from "./view";
import { NewTicketModal } from "./ticket";
import { editorContext } from "./context";
import { registerIcon, TRACCOON_ICON } from "./icon";

export default class TraccoonPlugin extends Plugin {
  settings!: TraccoonSettings;
  api!: TraccoonApi;
  private socket: OfficeSocket | null = null;
  private views = new Set<TraccoonChatView>();

  async onload(): Promise<void> {
    registerIcon();
    await this.loadSettings();
    this.api = new TraccoonApi(this.settings, () => this.saveSettings());

    this.registerView(VIEW_TYPE_TRACCOON, (leaf) => new TraccoonChatView(leaf, this));
    this.addSettingTab(new TraccoonSettingTab(this.app, this));
    this.addRibbonIcon(TRACCOON_ICON, "Traccoon Assistant", () => void this.openChat());

    this.addCommand({
      id: "open-chat",
      name: "Open assistant chat",
      callback: () => void this.openChat(),
    });

    this.addCommand({
      id: "send-selection",
      name: "Send selection to the assistant",
      editorCallback: async (editor) => {
        const text = editor.getSelection().trim();
        if (!text) return new Notice("Traccoon: nothing selected");
        const view = await this.openChat();
        await view?.send(text);
      },
    });

    this.addCommand({
      id: "new-ticket",
      name: "Create ticket from this note",
      callback: () => this.newTicket(),
    });

    this.app.workspace.onLayoutReady(() => this.reconnect());
  }

  onunload(): void {
    this.socket?.close();
    this.socket = null;
  }

  // -- views ----------------------------------------------------------------

  attachView(view: TraccoonChatView): void {
    this.views.add(view);
  }

  detachView(view: TraccoonChatView): void {
    this.views.delete(view);
  }

  async openChat(): Promise<TraccoonChatView | null> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRACCOON);
    const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return null;
    if (!existing.length) await leaf.setViewState({ type: VIEW_TYPE_TRACCOON, active: true });
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    return view instanceof TraccoonChatView ? view : null;
  }

  // -- websocket ------------------------------------------------------------

  /** Rebuilds the office socket after the token or the server address changed. */
  reconnect(): void {
    this.socket?.close();
    this.socket = null;
    if (!this.settings.liveEvents || !this.api.configured) return;
    this.socket = new OfficeSocket(
      () => this.api.wsUrl(),
      (ev) => {
        for (const v of this.views) v.onOfficeEvent(ev);
      },
    );
    this.socket.connect();
  }

  // -- tickets --------------------------------------------------------------

  private newTicket(): void {
    if (!this.api.configured) {
      new Notice("Traccoon: set server and access token first");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view?.editor?.getSelection()?.trim() ?? "";
    const ctx = editorContext(this.app, "path_only");

    const summary = selection ? selection.split("\n")[0].slice(0, 200) : file?.basename ?? "";
    const description = [selection, ctx ? `Obsidian: [[${ctx.path}]]` : ""]
      .filter(Boolean)
      .join("\n\n");

    new NewTicketModal(
      this.app,
      this.api,
      { summary, description, projectId: this.settings.ticketProjectId },
      (key) => void this.noteTicketKey(file, key),
    ).open();
  }

  /**
   * Writes the ticket key back into the note it came from.
   *
   * A ticket created out of a note and never named in it is a link that exists in one
   * direction only, and the note is the side that gets read later.
   */
  private async noteTicketKey(file: TFile | null, key: string): Promise<void> {
    if (!file || !this.settings.baseUrl) return;
    // A ticket key is `<project key>-<number>`, and the web address wants both parts.
    const projectKey = key.split("-")[0];
    const url = `${this.settings.baseUrl}/projects/${projectKey}/tickets/${key}`;
    const link = `\n- Traccoon: [${key}](${url})\n`;
    await this.app.vault.append(file, link);
  }

  // -- settings -------------------------------------------------------------

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

import { ItemView, MarkdownRenderer, Notice, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import type TraccoonPlugin from "./main";
import { RUNNING_STATES } from "./types";
import type { ChatMsg, OfficeEvent, Session } from "./types";
import { editorContext, withContext } from "./context";
import { TRACCOON_ICON } from "./icon";
import { TextPromptModal } from "./prompt";

export const VIEW_TYPE_TRACCOON = "traccoon-assistant-chat";

const PAGE = 20;
const IDLE_POLL_MS = 20_000;
const LIVE_LINES_PER_MSG = 200;

interface LiveLine {
  kind: string;
  text: string;
}

export class TraccoonChatView extends ItemView {
  private plugin: TraccoonPlugin;

  private messages: ChatMsg[] = [];
  private older: ChatMsg[] = [];
  private more = false;
  private archive = false;
  private busy = false;

  /** run id -> chat message id, so a stream of events knows which bubble it belongs to. */
  private runToMsg = new Map<number, number>();
  private live = new Map<number, LiveLine[]>();

  /** null while unknown, and stays null against a backend that has no sessions. */
  private sessions: Session[] | null = null;
  private sessionId: number | null = null;
  private showClosedSessions = false;

  private sessionBarEl!: HTMLElement;
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private contextEl!: HTMLElement;
  private poll: number | null = null;
  private stickToBottom = true;

  constructor(leaf: WorkspaceLeaf, plugin: TraccoonPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TRACCOON;
  }
  getDisplayText(): string {
    return "Traccoon Assistant";
  }
  getIcon(): string {
    return TRACCOON_ICON;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("traccoon-view");
    this.buildChrome();
    this.plugin.attachView(this);
    await this.loadSessions();
    await this.reload(true);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.renderContextChip()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.renderContextChip()));
  }

  async onClose(): Promise<void> {
    this.clearPoll();
    this.plugin.detachView(this);
  }

  // -- chrome ---------------------------------------------------------------

  private buildChrome(): void {
    const head = this.contentEl.createDiv({ cls: "traccoon-head" });
    head.createSpan({ cls: "traccoon-title", text: "Traccoon Assistant" });
    this.statusEl = head.createSpan({ cls: "traccoon-status", text: "" });

    const btn = (icon: string, label: string, fn: () => void) => {
      const b = head.createEl("button", { cls: "traccoon-icon-btn", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.onclick = fn;
      return b;
    };
    btn("refresh-cw", "Refresh", () => void this.reload(false));
    btn("archive", "Show archive", () => {
      this.archive = !this.archive;
      this.older = [];
      void this.reload(true);
    });
    btn("archive-restore", "Archive everything finished", async () => {
      if (this.archive) return;
      try {
        const out = await this.plugin.api.archiveAll();
        new Notice(`Traccoon: ${out.archived} archived`);
        this.older = [];
        await this.reload(true);
      } catch (e) {
        this.fail(e);
      }
    });

    this.sessionBarEl = this.contentEl.createDiv({ cls: "traccoon-sessions" });

    this.listEl = this.contentEl.createDiv({ cls: "traccoon-list" });
    this.listEl.onscroll = () => {
      const el = this.listEl;
      this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };

    const foot = this.contentEl.createDiv({ cls: "traccoon-foot" });
    this.contextEl = foot.createDiv({ cls: "traccoon-context" });
    this.inputEl = foot.createEl("textarea", {
      cls: "traccoon-input",
      attr: {
        rows: "3",
        placeholder: Platform.isMobile
          ? "Message to the assistant"
          : "Message to the assistant - Enter sends, Shift+Enter breaks the line",
      },
    });
    // On a phone Enter is how a paragraph is made, and there is no Shift to hold. Sending on
    // Enter there would make a multi-line message impossible to type.
    if (!Platform.isMobile) {
      this.inputEl.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void this.send();
        }
      };
    }
    const row = foot.createDiv({ cls: "traccoon-foot-row" });
    const send = row.createEl("button", { cls: "mod-cta", text: "Send" });
    send.onclick = () => void this.send();
    this.renderContextChip();
  }

  private renderContextChip(): void {
    const ctx = editorContext(this.app, this.plugin.settings.contextMode);
    this.contextEl.empty();
    if (!ctx) return;
    const sel = ctx.selection.trim();
    this.contextEl.createSpan({
      cls: "traccoon-chip",
      text: sel ? `${ctx.path} · selection ${sel.length} chars` : ctx.path,
    });
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private fail(e: unknown): void {
    const msg = (e as Error).message || "unknown error";
    this.setStatus(msg);
    new Notice(`Traccoon: ${msg}`);
  }

  // -- data -----------------------------------------------------------------

  async reload(resetScroll: boolean): Promise<void> {
    if (!this.plugin.api.configured) {
      this.clearPoll();
      this.setStatus("not configured");
      this.listEl.empty();
      this.listEl.createEl("p", {
        text: "Set the server and paste an access token under Settings -> Traccoon Assistant.",
      });
      return;
    }
    try {
      const page = await this.plugin.api.chat({
        limit: PAGE,
        archive: this.archive,
        sessionId: this.sessionId,
      });
      this.messages = page.messages;
      this.more = page.more;
      this.bindRunIds();
      this.setStatus(this.archive ? "archive" : "");
      this.render(resetScroll);
    } catch (e) {
      this.fail(e);
    } finally {
      this.schedulePoll();
    }
  }

  private async loadOlder(): Promise<void> {
    const oldest = this.all()[0]?.id;
    if (!oldest) return;
    try {
      const page = await this.plugin.api.chat({
        limit: PAGE,
        before: oldest,
        archive: this.archive,
        sessionId: this.sessionId,
      });
      this.older = [...page.messages, ...this.older];
      this.more = page.more;
      this.render(false);
    } catch (e) {
      this.fail(e);
    }
  }

  private all(): ChatMsg[] {
    return [...this.older, ...this.messages];
  }

  private hasRunning(): boolean {
    return this.messages.some((m) => RUNNING_STATES.includes(m.status));
  }

  /**
   * `run_id` is only in the payload when the backend carries the patch that exposes it.
   * Without it the websocket binds a run to the newest running message (see README).
   */
  private bindRunIds(): void {
    for (const m of this.messages) {
      if (typeof m.run_id === "number" && m.run_id) this.runToMsg.set(m.run_id, m.id);
    }
  }

  private schedulePoll(): void {
    this.clearPoll();
    const wait = this.hasRunning() ? this.plugin.settings.pollIntervalMs : IDLE_POLL_MS;
    this.poll = window.setTimeout(() => void this.reload(false), wait);
  }

  private clearPoll(): void {
    if (this.poll !== null) {
      window.clearTimeout(this.poll);
      this.poll = null;
    }
  }

  async send(text?: string): Promise<void> {
    if (this.busy) return;
    const raw = (text ?? this.inputEl.value).trim();
    if (!raw) return;
    const body = withContext(raw, editorContext(this.app, this.plugin.settings.contextMode));
    this.busy = true;
    try {
      if (text === undefined) this.inputEl.value = "";
      const msg = await this.plugin.api.send(body, this.sessionId);
      // Sending without a session lets the server open one; adopt it, otherwise the next
      // message would start yet another conversation.
      if (!this.sessionId && msg.session_id) {
        await this.setSession(msg.session_id, { reload: false });
        void this.loadSessions();
      }
      this.messages = [...this.messages, msg];
      this.stickToBottom = true;
      this.render(false);
      this.schedulePoll();
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
    }
  }

  private async decide(id: number, decision: "once" | "always" | "never"): Promise<void> {
    try {
      const updated = await this.plugin.api.decide(id, decision);
      this.messages = this.messages.map((m) => (m.id === id ? updated : m));
      this.render(false);
      this.schedulePoll();
    } catch (e) {
      this.fail(e);
    }
  }

  // -- sessions --------------------------------------------------------------

  /**
   * The list of conversations, and which one is open.
   *
   * A backend without sessions answers 404, `api.sessions()` turns that into null, and the
   * bar disappears — the plugin then behaves exactly as it did before sessions existed.
   */
  async loadSessions(): Promise<void> {
    if (!this.plugin.api.configured) return;
    try {
      const open = await this.plugin.api.sessions();
      if (open === null) {
        this.sessions = null;
        this.renderSessionBar();
        return;
      }
      const closed = this.showClosedSessions
        ? ((await this.plugin.api.sessions({ closed: true })) ?? [])
        : [];
      this.sessions = [...open, ...closed];
      this.pickSession();
      this.renderSessionBar();
    } catch (e) {
      this.fail(e);
    }
  }

  /** Which session the view lands in: the remembered one, else the one with the newest word. */
  private pickSession(): void {
    const list = this.sessions ?? [];
    if (this.sessionId && list.some((s) => s.id === this.sessionId)) return;
    const remembered = this.plugin.settings.lastSessionId;
    if (remembered && list.some((s) => s.id === remembered)) {
      this.sessionId = remembered;
      return;
    }
    const openOnes = list.filter((s) => !s.closed_at);
    const newest = [...openOnes].sort((a, b) => stamp(b) - stamp(a))[0];
    this.sessionId = newest ? newest.id : null;
  }

  private async setSession(id: number | null, opts: { reload?: boolean } = {}): Promise<void> {
    this.sessionId = id;
    this.plugin.settings.lastSessionId = id;
    await this.plugin.saveSettings();
    // A run belongs to the conversation it ran in; carrying the mapping across would paste
    // the tool log of one session under a message of another.
    this.runToMsg.clear();
    this.live.clear();
    this.older = [];
    this.stickToBottom = true;
    this.renderSessionBar();
    if (opts.reload !== false) await this.reload(true);
  }

  private renderSessionBar(): void {
    if (!this.sessionBarEl) return;
    this.sessionBarEl.empty();
    if (this.sessions === null) {
      this.sessionBarEl.addClass("traccoon-hidden");
      return;
    }
    this.sessionBarEl.removeClass("traccoon-hidden");

    const select = this.sessionBarEl.createEl("select", { cls: "dropdown traccoon-session-select" });
    if (!this.sessions.length) {
      select.createEl("option", { text: "no conversation yet", value: "" });
    }
    for (const s of [...this.sessions].sort((a, b) => stamp(b) - stamp(a))) {
      const mark = s.running ? "● " : s.closed_at ? "✓ " : "";
      const count = s.message_count ? ` (${s.message_count})` : "";
      select.createEl("option", {
        text: `${mark}${s.title || `#${s.id}`}${count}`,
        value: String(s.id),
      });
    }
    select.value = this.sessionId ? String(this.sessionId) : "";
    select.onchange = () => void this.setSession(select.value ? Number(select.value) : null);

    const btn = (icon: string, label: string, fn: () => void) => {
      const b = this.sessionBarEl.createEl("button", {
        cls: "traccoon-icon-btn",
        attr: { "aria-label": label },
      });
      setIcon(b, icon);
      b.onclick = fn;
    };

    btn("plus", "New conversation", () => this.newSession());
    btn("pencil", "Rename this conversation", () => this.renameSession());
    const current = this.sessions.find((s) => s.id === this.sessionId);
    if (current?.closed_at) {
      btn("rotate-ccw", "Reopen this conversation", () => void this.toggleClose(false));
    } else if (current) {
      btn("x", "Close this conversation", () => void this.toggleClose(true));
    }
    const eye = this.showClosedSessions ? "eye-off" : "eye";
    btn(eye, this.showClosedSessions ? "Hide closed ones" : "Show closed ones", () => {
      this.showClosedSessions = !this.showClosedSessions;
      void this.loadSessions();
    });
  }

  /** The command in the palette; the button in the bar goes through the same door. */
  startNewSession(): void {
    if (this.sessions === null) {
      new Notice("Traccoon: this server has no conversations yet");
      return;
    }
    this.newSession();
  }

  private newSession(): void {
    new TextPromptModal(
      this.app,
      {
        title: "New conversation",
        placeholder: "Title (empty: taken from the first message)",
        cta: "Create",
      },
      async (title) => void (await this.createSession(title)),
    ).open();
  }

  /** The modal only calls back with a non-empty value, so the empty case runs its own path. */
  private async createSession(title?: string): Promise<void> {
    try {
      const s = await this.plugin.api.createSession(title ? { title } : {});
      this.sessions = [...(this.sessions ?? []), s];
      await this.setSession(s.id);
      this.inputEl.focus();
    } catch (e) {
      this.fail(e);
    }
  }

  private renameSession(): void {
    const current = this.sessions?.find((s) => s.id === this.sessionId);
    if (!current) return;
    new TextPromptModal(
      this.app,
      { title: "Rename", value: current.title, cta: "Save" },
      async (title) => {
        try {
          await this.plugin.api.renameSession(current.id, title);
          await this.loadSessions();
        } catch (e) {
          this.fail(e);
        }
      },
    ).open();
  }

  private async toggleClose(close: boolean): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.plugin.api.closeSession(this.sessionId, close);
      if (close) {
        // Closing means stepping out of it: land in the next open one, or in none.
        this.sessionId = null;
        await this.loadSessions();
        await this.setSession(this.sessionId);
      } else {
        await this.loadSessions();
      }
    } catch (e) {
      this.fail(e);
    }
  }

  // -- live events ----------------------------------------------------------

  /**
   * One agent event from the office socket.
   *
   * Only project-less runs are of interest here: those are the assistant and the scheduled
   * jobs. Everything with a project belongs to a ticket and has its place in the web
   * interface.
   */
  onOfficeEvent(ev: OfficeEvent): void {
    if (ev.project_id) return;
    let msgId = this.runToMsg.get(ev.run_id);
    if (msgId === undefined) {
      const candidate = [...this.messages].reverse().find((m) => RUNNING_STATES.includes(m.status));
      if (!candidate) return;
      msgId = candidate.id;
      this.runToMsg.set(ev.run_id, msgId);
    }
    const line = this.lineOf(ev);
    if (!line) return;
    const lines = this.live.get(msgId) ?? [];
    lines.push(line);
    if (lines.length > LIVE_LINES_PER_MSG) lines.splice(0, lines.length - LIVE_LINES_PER_MSG);
    this.live.set(msgId, lines);
    this.appendLive(msgId, line);
    if (ev.kind === "run_end") {
      void this.reload(false);
      // The list carries the running marker and the moment of the last word; both just changed.
      void this.loadSessions();
    }
  }

  private lineOf(ev: OfficeEvent): LiveLine | null {
    const tool = ev.tool ?? "tool";
    const target = ev.target ? ` ${ev.target}` : "";
    switch (ev.kind) {
      case "run_start":
        return {
          kind: ev.kind,
          text: `run ${ev.run_id} started${ev.model ? ` · ${String(ev.model)}` : ""}`,
        };
      case "agent_text":
        return ev.text ? { kind: ev.kind, text: String(ev.text) } : null;
      case "tool_start":
        return { kind: ev.kind, text: `-> ${tool}${target}` };
      case "tool_result":
        return { kind: ev.kind, text: `${ev.ok === false ? "x" : "ok"} ${tool}${target}` };
      case "file_edit":
        return { kind: ev.kind, text: `edit ${ev.target ?? tool}` };
      case "agent_spawn":
        return { kind: ev.kind, text: `sub-agent ${ev.target ?? ""}`.trim() };
      case "run_end":
        return { kind: ev.kind, text: `run ${ev.run_id} finished` };
      default:
        return null;
    }
  }

  private appendLive(msgId: number, line: LiveLine): void {
    const host = this.listEl.querySelector<HTMLElement>(`[data-live="${msgId}"]`);
    if (!host) return;
    this.renderLine(host, line);
    if (this.stickToBottom) this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private renderLine(host: HTMLElement, line: LiveLine): void {
    host.createDiv({ cls: `traccoon-live-line traccoon-kind-${line.kind}`, text: line.text });
  }

  // -- rendering ------------------------------------------------------------

  private render(resetScroll: boolean): void {
    const before = this.listEl.scrollHeight;
    this.listEl.empty();

    if (this.more) {
      const b = this.listEl.createEl("button", { cls: "traccoon-more", text: "Load older" });
      b.onclick = () => void this.loadOlder();
    }

    for (const m of this.all()) this.renderMessage(m);

    if (resetScroll || this.stickToBottom) {
      this.listEl.scrollTop = this.listEl.scrollHeight;
    } else {
      this.listEl.scrollTop += this.listEl.scrollHeight - before;
    }
  }

  private renderMessage(m: ChatMsg): void {
    const wrap = this.listEl.createDiv({ cls: "traccoon-msg" });

    const mine = wrap.createDiv({ cls: "traccoon-bubble traccoon-mine" });
    mine.createDiv({ cls: "traccoon-text", text: m.text });

    const meta = wrap.createDiv({ cls: "traccoon-meta" });
    meta.createSpan({ cls: `traccoon-badge traccoon-${m.status}`, text: m.status });
    meta.createSpan({ text: new Date(m.created_at).toLocaleString() });
    if (!RUNNING_STATES.includes(m.status)) {
      const a = meta.createEl("button", {
        cls: "traccoon-link-btn",
        text: this.archive ? "unarchive" : "archive",
      });
      a.onclick = async () => {
        try {
          await this.plugin.api.archive(m.id, this.archive);
          this.older = this.older.filter((x) => x.id !== m.id);
          await this.reload(false);
        } catch (e) {
          this.fail(e);
        }
      };
    }

    if (m.status === "awaiting" && m.pending_tool) {
      const card = wrap.createDiv({ cls: "traccoon-perm" });
      card.createDiv({
        cls: "traccoon-perm-head",
        text: `The assistant wants to use: ${m.pending_tool}`,
      });
      const row = card.createDiv({ cls: "traccoon-perm-row" });
      const add = (label: string, decision: "once" | "always" | "never", cta = false) => {
        const b = row.createEl("button", { cls: cta ? "mod-cta" : "", text: label });
        b.onclick = () => void this.decide(m.id, decision);
      };
      add("Once", "once", true);
      add("Always", "always");
      add("Never", "never");
    }

    if (m.error) {
      wrap.createDiv({ cls: "traccoon-bubble traccoon-error", text: m.error });
    }

    if (m.result) {
      const out = wrap.createDiv({ cls: "traccoon-bubble traccoon-theirs" });
      void MarkdownRenderer.render(this.app, m.result, out, "", this);
    }

    const lines = this.live.get(m.id);
    const running = RUNNING_STATES.includes(m.status);
    if (running || (lines && lines.length > 0 && !m.result)) {
      const host = wrap.createDiv({ cls: "traccoon-live", attr: { "data-live": String(m.id) } });
      for (const l of lines ?? []) this.renderLine(host, l);
      if (!lines?.length && running) {
        host.createDiv({ cls: "traccoon-live-line traccoon-kind-wait", text: "working..." });
      }
    }
  }
}

/** The moment a conversation was last spoken in, for ordering. */
function stamp(s: Session): number {
  const when = s.last_message_at || s.created_at;
  const t = Date.parse(when);
  return Number.isNaN(t) ? 0 : t;
}

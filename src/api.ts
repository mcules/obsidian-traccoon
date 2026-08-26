import { requestUrl, RequestUrlResponse } from "obsidian";
import type { ChatMsg, ChatPage, Issue, OfficeEvent, Project, Session } from "./types";
import type { TraccoonSettings } from "./settings";

export class TraccoonError extends Error {
  status: number;
  key?: string;
  constructor(status: number, message: string, key?: string) {
    super(message);
    this.status = status;
    this.key = key;
  }
}

/**
 * Thin client for the Traccoon REST API.
 *
 * Everything goes through `requestUrl`: a plain `fetch` from a plugin is subject to the
 * origin rules of the Obsidian window, and Traccoon sits on a different host.
 */
export class TraccoonApi {
  constructor(
    private settings: TraccoonSettings,
    private persist: () => Promise<void>,
  ) {}

  get configured(): boolean {
    return Boolean(this.settings.baseUrl && this.settings.token);
  }

  private url(path: string): string {
    if (!this.settings.baseUrl) throw new TraccoonError(0, "No server configured");
    return `${this.settings.baseUrl}/api${path}`;
  }

  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.settings.token) headers["Authorization"] = `Bearer ${this.settings.token}`;

    let res: RequestUrlResponse;
    try {
      res = await requestUrl({
        url: this.url(path),
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        throw: false,
      });
    } catch (e) {
      throw new TraccoonError(0, (e as Error).message || "Network error");
    }

    if (res.status === 401) {
      // The token is unknown, revoked or expired. It is NOT dropped here: a token the human
      // pasted stays where they put it, and a server that was briefly reachable under a
      // wrong address must not cost them the value in the settings field.
      throw new TraccoonError(401, "Token rejected — check it in the settings");
    }
    if (res.status >= 400) {
      let detail = `HTTP ${res.status}`;
      let key: string | undefined;
      try {
        const j = res.json as { detail?: unknown; key?: unknown };
        if (typeof j?.detail === "string") detail = j.detail;
        else if (j?.detail !== undefined) detail = JSON.stringify(j.detail);
        if (typeof j?.key === "string") key = j.key;
      } catch {
        /* body was not json */
      }
      if (res.status === 403) {
        // The most likely reason by far, and the one the server cannot phrase for us.
        detail += " (token scope? the chat needs 'assistant', a ticket needs 'tickets')";
      }
      throw new TraccoonError(res.status, detail, key);
    }
    if (res.status === 204 || !res.text) return undefined as T;
    return res.json as T;
  }

  /**
   * Who the token belongs to.
   *
   * There is no login and no refresh here on purpose. A password in the settings would be a
   * credential that cannot be taken back without changing it everywhere; the access token
   * can be revoked in Traccoon on its own, which is the whole point of using one.
   */
  me(): Promise<{ id: number; username: string; email: string }> {
    return this.request("/auth/me");
  }

  chat(
    opts: { limit?: number; before?: number; archive?: boolean; sessionId?: number | null } = {},
  ): Promise<ChatPage> {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 20) });
    if (opts.before) q.set("before", String(opts.before));
    if (opts.archive) q.set("archive", "1");
    if (opts.sessionId) q.set("session_id", String(opts.sessionId));
    return this.request(`/assistant/chat?${q.toString()}`);
  }

  send(text: string, sessionId?: number | null): Promise<ChatMsg> {
    const body: { text: string; session_id?: number } = { text };
    if (sessionId) body.session_id = sessionId;
    return this.request("/assistant/chat", "POST", body);
  }

  // -- sessions --------------------------------------------------------------
  //
  // A backend without sessions answers 404 here. `sessions()` turns that into null so the
  // view can hide its switcher instead of showing an error for a feature that simply is not
  // there yet — the two sides can then be deployed in either order.

  async sessions(opts: { closed?: boolean; agent?: string } = {}): Promise<Session[] | null> {
    const q = new URLSearchParams();
    if (opts.closed) q.set("closed", "1");
    if (opts.agent) q.set("agent", opts.agent);
    try {
      return await this.request<Session[]>(`/assistant/sessions?${q.toString()}`);
    } catch (e) {
      if (e instanceof TraccoonError && e.status === 404) return null;
      throw e;
    }
  }

  createSession(data: { title?: string; agent?: string } = {}): Promise<Session> {
    return this.request("/assistant/sessions", "POST", data);
  }

  renameSession(id: number, title: string): Promise<Session> {
    return this.request(`/assistant/sessions/${id}`, "PATCH", { title });
  }

  closeSession(id: number, closed: boolean): Promise<Session> {
    return this.request(`/assistant/sessions/${id}/${closed ? "close" : "reopen"}`, "POST");
  }

  decide(id: number, decision: "once" | "always" | "never"): Promise<ChatMsg> {
    return this.request(`/assistant/chat/${id}/decide`, "POST", { decision });
  }

  archive(id: number, archived: boolean): Promise<ChatMsg> {
    return this.request(`/assistant/chat/${id}/${archived ? "unarchive" : "archive"}`, "POST");
  }

  archiveAll(): Promise<{ archived: number }> {
    return this.request("/assistant/chat/archive-all", "POST");
  }

  projects(): Promise<Project[]> {
    return this.request("/projects");
  }

  createIssue(
    projectId: number,
    data: { summary: string; description?: string; priority?: string },
  ): Promise<Issue> {
    return this.request(`/projects/${projectId}/issues`, "POST", data);
  }

  /**
   * The snapshot of one room, used to close the gap after a reconnect.
   *
   * Lives under `/office/*`, which a token only reaches with a wide enough scope — hence the
   * null on 403/404 instead of an error: without the snapshot the chat simply misses the tool
   * log of those seconds, and the result still arrives over REST.
   */
  async runEvents(
    runId: number,
    afterSeq?: number,
  ): Promise<{ events: OfficeEvent[]; seq_to: number } | null> {
    const q = afterSeq ? `?after_seq=${afterSeq}` : "";
    try {
      return await this.request(`/office/sessions/run/${runId}/events${q}`);
    } catch (e) {
      if (e instanceof TraccoonError && (e.status === 403 || e.status === 404)) return null;
      throw e;
    }
  }

  wsUrl(): string {
    const base = this.settings.baseUrl.replace(/^http/, "ws");
    return `${base}/api/ws?token=${encodeURIComponent(this.settings.token)}`;
  }
}

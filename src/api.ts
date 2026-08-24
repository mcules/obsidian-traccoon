import { requestUrl, RequestUrlResponse } from "obsidian";
import type { ChatMsg, ChatPage, Issue, Project } from "./types";
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

    if (res.status === 401 && !path.startsWith("/auth/")) {
      // The token is gone or expired. Dropping it here keeps the plugin from hammering the
      // server with a credential that will never work again.
      this.settings.token = "";
      await this.persist();
      throw new TraccoonError(401, "Not authenticated — log in again in the settings");
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
      throw new TraccoonError(res.status, detail, key);
    }
    if (res.status === 204 || !res.text) return undefined as T;
    return res.json as T;
  }

  async login(email: string, password: string): Promise<void> {
    if (!email || !password) throw new TraccoonError(0, "E-mail and password are required");
    const out = await this.request<{ access_token: string }>("/auth/login", "POST", {
      email,
      password,
    });
    this.settings.token = out.access_token;
    this.settings.email = email;
    await this.persist();
  }

  /** Keeps a long-lived session alive without storing the password. */
  async refresh(): Promise<void> {
    if (!this.settings.token) return;
    const out = await this.request<{ access_token: string }>("/auth/refresh", "POST");
    this.settings.token = out.access_token;
    await this.persist();
  }

  me(): Promise<{ id: number; username: string; email: string }> {
    return this.request("/auth/me");
  }

  chat(opts: { limit?: number; before?: number; archive?: boolean } = {}): Promise<ChatPage> {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 20) });
    if (opts.before) q.set("before", String(opts.before));
    if (opts.archive) q.set("archive", "1");
    return this.request(`/assistant/chat?${q.toString()}`);
  }

  send(text: string): Promise<ChatMsg> {
    return this.request("/assistant/chat", "POST", { text });
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

  wsUrl(): string {
    const base = this.settings.baseUrl.replace(/^http/, "ws");
    return `${base}/api/ws?token=${encodeURIComponent(this.settings.token)}`;
  }
}

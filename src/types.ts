export const RUNNING_STATES = ["new", "approved", "running", "awaiting"];

export interface ChatMsg {
  id: number;
  text: string;
  status: string;
  result: string;
  error: string;
  pending_tool: string | null;
  created_at: string;
  finished_at?: string | null;
  /** Only present when the backend carries the patch that exposes it (see README). */
  run_id?: number | null;
}

export interface ChatPage {
  messages: ChatMsg[];
  more: boolean;
}

export interface Project {
  id: number;
  key: string;
  name: string;
}

export interface Issue {
  key: string;
  summary: string;
}

/** Envelope of `services/office.py` — one agent event. */
export interface OfficeEvent {
  v: number;
  seq: number;
  ts: string;
  sid: string;
  run_id: number;
  agent_id: string;
  project_id?: number | null;
  issue_key?: string;
  kind: string;
  text?: string;
  tool?: string;
  target?: string;
  args?: string;
  result?: string;
  ok?: boolean | null;
  [k: string]: unknown;
}

export interface ContextPayload {
  path: string;
  selection: string;
}

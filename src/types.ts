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
  run_id?: number | null;
  session_id?: number | null;
}

/** How full the window was on the newest run of a conversation. Absent on older backends. */
export interface SessionContext {
  input_tokens: number;
  model: string;
  context_tokens: number | null;
  pct: number | null;
  verbatim_exchanges?: number;
  summary_chars?: number;
  measured_at?: string;
}

export interface Session {
  id: number;
  agent: string;
  title: string;
  created_at: string;
  last_message_at: string | null;
  closed_at: string | null;
  message_count?: number;
  running?: boolean;
  context?: SessionContext | null;
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

import { App, MarkdownView } from "obsidian";
import type { ContextMode } from "./settings";
import type { ContextPayload } from "./types";

/** What the editor currently shows, as far as the settings allow it to travel. */
export function editorContext(app: App, mode: ContextMode): ContextPayload | null {
  if (mode === "off") return null;
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file ?? app.workspace.getActiveFile();
  if (!file) return null;
  const selection = mode === "path_and_selection" ? view?.editor?.getSelection() ?? "" : "";
  return { path: file.path, selection };
}

const MAX_SELECTION = 8000;

/**
 * The message as the assistant sees it.
 *
 * The path is named rather than the whole note pasted in: the assistant reads the vault
 * through its own MCP server, so a path is an address it can follow, while a paste is a copy
 * that ages the moment it is sent. The selection is the exception — it is the part the human
 * is pointing at, and nothing on the other side can guess which lines those were.
 */
export function withContext(text: string, ctx: ContextPayload | null): string {
  if (!ctx) return text;
  const parts = [text.trim(), "", `— Obsidian: [[${ctx.path}]]`];
  const sel = ctx.selection.trim();
  if (sel) {
    const cut = sel.length > MAX_SELECTION;
    parts.push("", "Selection:", "```", cut ? `${sel.slice(0, MAX_SELECTION)}\n…` : sel, "```");
  }
  return parts.join("\n");
}

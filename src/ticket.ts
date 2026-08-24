import { App, Modal, Notice, Setting } from "obsidian";
import type { TraccoonApi } from "./api";
import type { Project } from "./types";

const PRIORITIES = ["lowest", "low", "medium", "high", "highest"];

/** Turn the note (or the selection) into a Traccoon ticket. */
export class NewTicketModal extends Modal {
  private summary: string;
  private description: string;
  private priority = "medium";
  private projectId: number | null;
  private projects: Project[] = [];

  constructor(
    app: App,
    private api: TraccoonApi,
    defaults: { summary: string; description: string; projectId: number | null },
    private onCreated: (key: string) => void,
  ) {
    super(app);
    this.summary = defaults.summary;
    this.description = defaults.description;
    this.projectId = defaults.projectId;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "New Traccoon ticket" });

    try {
      this.projects = await this.api.projects();
    } catch (e) {
      contentEl.createEl("p", { text: `Projects could not be loaded: ${(e as Error).message}` });
    }

    new Setting(contentEl).setName("Project").addDropdown((d) => {
      for (const p of this.projects) d.addOption(String(p.id), `${p.key} — ${p.name}`);
      if (this.projectId && this.projects.some((p) => p.id === this.projectId)) {
        d.setValue(String(this.projectId));
      } else if (this.projects.length) {
        this.projectId = this.projects[0].id;
        d.setValue(String(this.projectId));
      }
      d.onChange((v) => (this.projectId = Number(v)));
    });

    new Setting(contentEl).setName("Summary").addText((t) => {
      t.setValue(this.summary).onChange((v) => (this.summary = v));
      t.inputEl.classList.add("traccoon-wide-input");
    });

    new Setting(contentEl).setName("Priority").addDropdown((d) => {
      for (const p of PRIORITIES) d.addOption(p, p);
      d.setValue(this.priority).onChange((v) => (this.priority = v));
    });

    new Setting(contentEl).setName("Description").addTextArea((t) => {
      t.setValue(this.description).onChange((v) => (this.description = v));
      t.inputEl.rows = 10;
      t.inputEl.classList.add("traccoon-wide-input");
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Create")
        .setCta()
        .onClick(async () => {
          if (!this.projectId) return new Notice("Pick a project first");
          if (!this.summary.trim()) return new Notice("A summary is required");
          try {
            const issue = await this.api.createIssue(this.projectId, {
              summary: this.summary.trim(),
              description: this.description,
              priority: this.priority,
            });
            new Notice(`Traccoon: ${issue.key} created`);
            this.onCreated(issue.key);
            this.close();
          } catch (e) {
            new Notice(`Ticket failed: ${(e as Error).message}`);
          }
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

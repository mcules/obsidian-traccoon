import { App, Modal, Setting } from "obsidian";

/** One line of text, asked for in a modal — Obsidian has no `window.prompt`. */
export class TextPromptModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private opts: {
      title: string;
      placeholder?: string;
      value?: string;
      cta?: string;
      /** When true an empty answer is passed on instead of swallowed. */
      allowEmpty?: boolean;
    },
    private onSubmit: (value: string) => void,
  ) {
    super(app);
    this.value = opts.value ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.title });

    const submit = () => {
      const v = this.value.trim();
      this.close();
      if (v || this.opts.allowEmpty) this.onSubmit(v);
    };

    new Setting(contentEl).addText((t) => {
      t.setPlaceholder(this.opts.placeholder ?? "")
        .setValue(this.value)
        .onChange((v) => (this.value = v));
      t.inputEl.classList.add("traccoon-wide-input");
      t.inputEl.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      };
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.opts.cta ?? "OK")
        .setCta()
        .onClick(submit),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

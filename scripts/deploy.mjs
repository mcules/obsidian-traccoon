import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import process from "process";

// The vault to install into. Override with TRACCOON_VAULT when there is more than one.
const VAULT =
  process.env.TRACCOON_VAULT ||
  "C:\\Users\\DennisEisold\\Sync\\Obsidian\\Second Brain";

const target = join(VAULT, ".obsidian", "plugins", "traccoon-assistant");

if (!existsSync(join(VAULT, ".obsidian"))) {
  console.error(`No vault at ${VAULT} — set TRACCOON_VAULT`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(target, file));
}
console.log(`installed to ${target}`);
console.log("Reload Obsidian or disable/enable the plugin to pick it up.");

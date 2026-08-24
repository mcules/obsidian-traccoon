import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import process from "process";

/**
 * Copy a build into a vault for testing.
 *
 * The vault path is not in this file: it names a machine, and this repository is public.
 * Set TRACCOON_VAULT, or drop the path into `vault.local` next to this repo (git-ignored).
 */
const local = existsSync("vault.local") ? readFileSync("vault.local", "utf8").trim() : "";
const VAULT = process.env.TRACCOON_VAULT || local;

if (!VAULT) {
  console.error("No vault. Set TRACCOON_VAULT=… or write the path into vault.local");
  process.exit(1);
}
if (!existsSync(join(VAULT, ".obsidian"))) {
  console.error(`No vault at ${VAULT} — nothing at .obsidian there`);
  process.exit(1);
}

const target = join(VAULT, ".obsidian", "plugins", "traccoon-assistant");
mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(target, file));
}
console.log(`installed to ${target}`);
console.log("Reload Obsidian or disable/enable the plugin to pick it up.");

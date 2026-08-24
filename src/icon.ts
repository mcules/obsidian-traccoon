import { addIcon } from "obsidian";

export const TRACCOON_ICON = "traccoon-raccoon";

/**
 * The raccoon mask, drawn as line art.
 *
 * Obsidian's own icons are lucide: a 24×24 grid, no fill, stroke 2, round caps. `addIcon`
 * however works on a 100×100 viewBox, so the stroke here is 7 — the same optical weight
 * scaled up (2/24 ≈ 7/100). Everything paints in `currentColor`, which is what lets the
 * ribbon, the tab header and a hovered state colour the icon like every other one.
 *
 * The same geometry lives in `docs/favicon.svg` for Traccoon itself, with fixed colours,
 * because a favicon has no surrounding text colour to inherit.
 */
const SVG = `
<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M24 32 L31 13 L46 25"/>
  <path d="M76 32 L69 13 L54 25"/>
  <path d="M50 21 C73 21 85 38 85 55 C85 74 69 88 50 88 C31 88 15 74 15 55 C15 38 27 21 50 21 Z"/>
  <path d="M23 47 C29 40 38 40 43 47"/>
  <path d="M77 47 C71 40 62 40 57 47"/>
  <path d="M50 71 L50 78"/>
</g>
<circle cx="35" cy="56" r="5" fill="currentColor"/>
<circle cx="65" cy="56" r="5" fill="currentColor"/>
<path d="M50 71 L43 64 L57 64 Z" fill="currentColor"/>
`;

/** Registers the icon once per load; calling it twice would only overwrite the same name. */
export function registerIcon(): void {
  addIcon(TRACCOON_ICON, SVG);
}

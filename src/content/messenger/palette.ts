// Pins Facebook's whole palette to one mode under a theme. The light half is
// ported from fMess 20-theme.js lightColours() (MIT,
// https://github.com/toanbku/fmess).
//
// A theme only remaps the variables it knows; every other Facebook colour
// (menus, dialogs, cards) would follow Facebook's own mode, so a light
// theme in dark mode, or a dark theme in light mode, would show panels of
// the wrong mode. Facebook's palettes live in two large `.__fb-light-mode`
// and `.__fb-dark-mode` rules; the wanted one's custom properties are
// copied onto the other mode's selectors. Stylesheets that are cross-origin
// without CORS throw on cssRules; they are skipped and the theme's own
// palette still applies.

export type PaletteMode = 'light' | 'dark';

function collect(source: string): string {
  const pattern = new RegExp(source);
  let colours = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!pattern.test(rule.selectorText) || rule.style.length <= 100) continue;
      for (const name of Array.from(rule.style)) {
        if (name.startsWith('--')) colours += `${name}: ${rule.style.getPropertyValue(name)} !important;`;
      }
    }
  }
  return colours;
}

export function buildPaletteCss(mode: PaletteMode): string {
  if (mode === 'light') {
    const colours = collect('__fb-light-mode');
    return colours ? `.__fb-dark-mode { ${colours} color-scheme: light; }\n` : '';
  }
  const colours = collect('__fb-dark-mode');
  return colours ? `:root, .__fb-light-mode { ${colours} color-scheme: dark; }\n` : '';
}

#!/usr/bin/env node
// Compiles tokens.json into per-platform outputs. Every UI surface derives
// its palette from this one file, so a color change propagates everywhere in
// one commit. CSS drives the web app (and the Tauri popover); Kotlin drives
// the Android companion's Glance widgets and native capture UI (ADR-0004).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));

const colorVars = (theme) =>
  Object.entries(tokens.color[theme])
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');

const scaleVars = (group, unit = '') =>
  Object.entries(tokens[group])
    .map(([k, v]) => `  --${group}-${k}: ${v}${unit};`)
    .join('\n');

const css = `/* GENERATED from tokens.json — do not edit by hand. Regenerate: make tokens */
:root {
${colorVars('dark')}
${scaleVars('space', 'px')}
${scaleVars('radius', 'px')}
${scaleVars('text', 'px')}
  --font-ui: ${tokens.font.ui};
  --font-mono: ${tokens.font.mono};
}
:root[data-theme='light'] {
${colorVars('light')}
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) {
${colorVars('light')}
  }
}
`;

// Android: Compose/Glance Color constants. Hex like #131110 becomes the
// Compose 0xFFRRGGBB long form so widgets share the exact web palette.
const hexToComposeColor = (hex) => {
  const h = hex.replace('#', '');
  const rgb = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return `Color(0xFF${rgb.toUpperCase()})`;
};

const kotlinColors = (theme) =>
  Object.entries(tokens.color[theme])
    .map(([k, v]) => `    val ${camel(k)} = ${hexToComposeColor(v)}`)
    .join('\n');

const kotlinDp = (group) =>
  Object.entries(tokens[group])
    .map(([k, v]) => `  val ${group}${capitalize(k)} = ${v}.dp`)
    .join('\n');

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// kebab -> valid camelCase identifier: `surface-2` -> `surface2`,
// `on-accent` -> `onAccent`. Uppercases a letter after a hyphen, drops any
// remaining hyphens (e.g. before a digit) so the result is a legal Kotlin id.
function camel(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/-/g, '');
}

const kotlin = `// GENERATED from tokens.json — do not edit by hand. Regenerate: make tokens
package com.dataforge.companion.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object ForgeTokens {
  object Dark {
${kotlinColors('dark')}
  }
  object Light {
${kotlinColors('light')}
  }
${kotlinDp('space')}
${kotlinDp('radius')}
}
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'tokens.css'), css);
writeFileSync(join(root, 'dist', 'ForgeTokens.kt'), kotlin);
console.log('tokens: dist/tokens.css + dist/ForgeTokens.kt written');

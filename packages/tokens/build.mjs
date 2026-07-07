#!/usr/bin/env node
// Compiles tokens.json into per-platform outputs. Every UI surface derives
// its palette from this one file, so a color change propagates everywhere in
// one commit. CSS is the only target today; Kotlin (Android widgets) and
// Swift emitters land together with their platforms (see ADR-0004).
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

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'tokens.css'), css);
console.log('tokens: dist/tokens.css written');

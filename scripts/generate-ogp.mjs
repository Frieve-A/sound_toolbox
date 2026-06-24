// One-off generator for per-tool OGP images.
// Reads the shared base art (public/ogp_base.jpg) and composites each tool's
// name into the empty lower half, then writes <tool>/ogp.jpg.
//
// Run manually:  node scripts/generate-ogp.mjs
// (sharp is available via the Astro toolchain; it is not a build-time dependency.)
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = path.join(root, 'public', 'ogp_base.jpg');

const W = 1200;
const H = 630;
const MAX_TEXT_WIDTH = 1080;
const TEXT_CENTER_Y = 448;

// Tool name shown on the art. "Frieve" is dropped because the base art already
// reads "Frieve's", so the prefix would otherwise repeat.
const tools = [
  { dir: 'oscillator', text: 'Web Oscillator' },
  { dir: 'preview_audio_player', text: 'Preview Audio Player' },
  { dir: 'sound_abx_tester', text: 'Sound ABX Tester' },
  { dir: 'digital_sampling_visualizer', text: 'Digital Sampling Visualizer' },
  { dir: 'dsd_explained', text: 'DSD Explained' },
  { dir: 'earphone_cable_impact_analyzer', text: 'Earphone Cable Impact Analyzer' },
  { dir: 'masking_experience', text: 'Auditory Masking Experience' },
];

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch],
  );
}

function fitFontSize(text) {
  // Arial Black glyphs are wide (~0.66em average). Size to fit MAX_TEXT_WIDTH,
  // capped so short names do not look oversized.
  const estimated = MAX_TEXT_WIDTH / (text.length * 0.66);
  return Math.round(Math.min(84, estimated));
}

function overlaySvg(text) {
  const fontSize = fitFontSize(text);
  const label = escapeXml(text);
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="soft" x="-20%" y="-40%" width="140%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="8" flood-color="#000000" flood-opacity="0.7"/>
    </filter>
  </defs>
  <text x="${W / 2}" y="${TEXT_CENTER_Y}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${fontSize}"
        fill="#ffffff" filter="url(#soft)">${label}</text>
</svg>`);
}

const baseImage = sharp(base);

for (const tool of tools) {
  const out = path.join(root, tool.dir, 'ogp.jpg');
  const info = await baseImage
    .clone()
    .composite([{ input: overlaySvg(tool.text), top: 0, left: 0 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(out);
  console.log(`${tool.dir}/ogp.jpg  ${info.width}x${info.height}  ${info.size} bytes`);
}

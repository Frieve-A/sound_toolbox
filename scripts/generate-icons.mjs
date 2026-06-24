// Generator for per-tool PWA icons.
// Reads each tool's full-resolution icon.png (kept in the repo as the master)
// and emits compressed icon-192x192.png / icon-512x512.png that the manifest
// references, so clients pick the resolution they need instead of downloading
// the multi-hundred-KB master.
//
// Run manually:  node scripts/generate-icons.mjs
// (sharp is available via the Astro toolchain; it is not a build-time dependency.)
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Tools whose icon.png master should be downscaled into the standard PWA sizes.
const tools = [
  'digital_sampling_visualizer',
  'earphone_cable_impact_analyzer',
  'masking_experience',
];

const sizes = [192, 512];

for (const dir of tools) {
  const master = path.join(root, dir, 'icon.png');
  for (const size of sizes) {
    const out = path.join(root, dir, `icon-${size}x${size}.png`);
    const info = await sharp(master)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 })
      .toFile(out);
    console.log(`${dir}/icon-${size}x${size}.png  ${info.width}x${info.height}  ${info.size} bytes`);
  }
}

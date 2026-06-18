import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = path.join(root, 'dist');

const ignoredTopLevel = new Set([
  '.agents',
  '.astro',
  '.codex',
  '.git',
  '.github',
  '.qodo',
  'dist',
  'node_modules',
  'public',
  'scripts',
  'src',
]);

const ignoredFiles = new Set([
  '.gitignore',
  '_config.yml',
  'astro.config.mjs',
  'package-lock.json',
  'package.json',
  'server.py',
  'tsconfig.json',
]);

function isReadme(fileName) {
  return /^readme\.md$/i.test(fileName);
}

async function copyEntry(source, destination, depth = 0) {
  const name = path.basename(source);

  if (depth === 0 && ignoredTopLevel.has(name)) {
    return;
  }

  if (isReadme(name) || ignoredFiles.has(name)) {
    return;
  }

  const sourceStat = await stat(source);

  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source);
    await Promise.all(
      entries.map((entry) =>
        copyEntry(path.join(source, entry), path.join(destination, entry), depth + 1),
      ),
    );
    return;
  }

  try {
    await stat(destination);
    return;
  } catch {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

await mkdir(outDir, { recursive: true });

const entries = await readdir(root);
await Promise.all(entries.map((entry) => copyEntry(path.join(root, entry), path.join(outDir, entry))));

console.log('Copied legacy static assets into dist.');

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { isReadmeHref, normalizeProjectHref, readmeTargetToRoute, toSiteHref } from './paths';

export const workspaceRoot = process.cwd();

type MarkdownToken = Record<string, any>;

export type ReadmePage = {
  filePath: string;
  sourceDir: string;
  slug: string;
  title: string;
};

type ToolCard = {
  id: string;
  title: string;
  description: string;
  descriptionJa: string;
  readmeHref: string;
  appHref: string;
  appHrefJa: string;
  imageSrc: string;
  imageSrcJa: string;
  imageAlt: string;
  iconSrc: string;
};

const ignoredDirs = new Set([
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

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

// Each tool keeps its own app/PWA icon under its directory; filenames vary by
// tool. Resolve the first one that exists so the home cards and guide pages can
// show a per-app icon. Card thumbnails are small, so prefer the downscaled,
// web-weight variants and fall back to the full-resolution master only when no
// smaller icon exists.
const ICON_CANDIDATES = [
  'assets/icon_64x64.png',
  'icon-192x192.png',
  'icon-512x512.png',
  'assets/icon.png',
  'icon.png',
];

function resolveToolIcon(sourceDir: string): string {
  if (!sourceDir) {
    return '';
  }

  for (const name of ICON_CANDIDATES) {
    const relative = `${sourceDir}/${name}`;
    if (existsSync(path.join(workspaceRoot, relative))) {
      return relative;
    }
  }

  return '';
}

async function collectReadmeFiles(dir = workspaceRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...(await collectReadmeFiles(path.join(dir, entry.name))));
      }
      continue;
    }

    if (/^readme\.md$/i.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

export async function getReadmePages(): Promise<ReadmePage[]> {
  const files = await collectReadmeFiles();
  const pages = await Promise.all(
    files.map(async (filePath: string) => {
      const relativeFile = toPosixPath(path.relative(workspaceRoot, filePath));
      const sourceDir = toPosixPath(path.dirname(relativeFile)).replace(/^\.$/, '');
      const markdown = await readFile(filePath, 'utf8');
      const tokens = marked.lexer(markdown, { gfm: true });
      const titleToken = tokens.find(
        (token: MarkdownToken) => token.type === 'heading' && token.depth === 1,
      ) as MarkdownToken | undefined;
      const title = titleToken?.text ?? (sourceDir || 'Sound Toolbox');

      return {
        filePath,
        sourceDir,
        slug: sourceDir,
        title,
      };
    }),
  );

  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

function paragraphTextWithoutLinks(token: MarkdownToken): string {
  const inlineTokens = token.tokens ?? [];
  const text = inlineTokens
    .map((child: MarkdownToken) => {
      if (child.type === 'text' || child.type === 'escape' || child.type === 'codespan') {
        return child.text ?? child.raw ?? '';
      }

      if (child.type === 'strong' || child.type === 'em') {
        return child.text ?? '';
      }

      if (child.type === 'br') {
        return ' ';
      }

      return '';
    })
    .join('');

  return text.replace(/\s+/g, ' ').trim();
}

function firstLink(
  token: MarkdownToken,
  predicate: (link: MarkdownToken) => boolean = () => true,
): MarkdownToken | undefined {
  return (token.tokens ?? []).find(
    (child: MarkdownToken) => child.type === 'link' && predicate(child),
  );
}

function firstImage(token: MarkdownToken): MarkdownToken | undefined {
  return (token.tokens ?? []).find((child: MarkdownToken) => child.type === 'image');
}

function hasJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function parseToolCards(markdown: string): ToolCard[] {
  const tokens = marked.lexer(markdown, { gfm: true });
  const cards = new Map<string, ToolCard>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type !== 'paragraph') {
      continue;
    }

    const readmeLink = firstLink(token, (link) => isReadmeHref(link.href));
    if (!readmeLink) {
      continue;
    }

    const rawReadmeRoute = readmeTargetToRoute(readmeLink.href);
    const id = normalizeProjectHref(rawReadmeRoute).replace(/\/$/, '');
    const title = readmeLink.text;
    let description = '';
    let appHref = '';
    let imageSrc = '';
    let imageAlt = '';

    for (let lookahead = index + 1; lookahead < tokens.length; lookahead += 1) {
      const next = tokens[lookahead];
      if (next.type === 'hr') {
        break;
      }

      if (next.type !== 'paragraph') {
        continue;
      }

      const appLink = firstLink(next, (link) => !isReadmeHref(link.href));
      if (!description && appLink) {
        description = paragraphTextWithoutLinks(next);
        appHref = normalizeProjectHref(appLink.href);
      }

      const image = firstImage(next);
      if (!imageSrc && image) {
        imageSrc = normalizeProjectHref(image.href);
        imageAlt = image.text;
      }
    }

    const card = cards.get(id) ?? {
      id,
      title,
      description: '',
      descriptionJa: '',
      readmeHref: rawReadmeRoute,
      appHref: '',
      appHrefJa: '',
      imageSrc: '',
      imageSrcJa: '',
      imageAlt: '',
      iconSrc: '',
    };

    if (hasJapanese(`${title} ${description}`)) {
      card.descriptionJa = description || card.descriptionJa;
      card.appHrefJa = appHref || card.appHrefJa;
      card.imageSrcJa = imageSrc || card.imageSrcJa;
    } else {
      card.title = title || card.title;
      card.description = description || card.description;
      card.appHref = appHref || card.appHref;
      card.imageSrc = imageSrc || card.imageSrc;
      card.imageAlt = imageAlt || card.imageAlt;
    }

    cards.set(id, card);
  }

  return [...cards.values()];
}

function normalizePageRelativeHref(href: string, sourceDir: string): string {
  const normalized = normalizeProjectHref(href);

  if (normalized !== href || /^(?:https?:|mailto:|tel:|#|\/)/i.test(normalized)) {
    return normalized;
  }

  return path.posix.normalize(`${sourceDir}/${normalized.replace(/^\.\//, '')}`);
}

function parseStandaloneToolCard(markdown: string, sourceDir: string): ToolCard | null {
  const tokens = marked.lexer(markdown, { gfm: true });
  const titleToken = tokens.find(
    (token: MarkdownToken) => token.type === 'heading' && token.depth === 1,
  ) as MarkdownToken | undefined;
  const title = titleToken?.text ?? sourceDir;

  const card: ToolCard = {
    id: sourceDir,
    title,
    description: '',
    descriptionJa: '',
    readmeHref: `${sourceDir}/`,
    appHref: '',
    appHrefJa: '',
    imageSrc: '',
    imageSrcJa: '',
    imageAlt: '',
    iconSrc: '',
  };

  let lastLanguage: 'en' | 'ja' = hasJapanese(title) ? 'ja' : 'en';

  for (const token of tokens) {
    if (token.type !== 'paragraph') {
      continue;
    }

    const image = firstImage(token);
    if (image) {
      const imageLanguage = hasJapanese(`${image.text ?? ''}`) ? 'ja' : lastLanguage;
      if (imageLanguage === 'ja') {
        card.imageSrcJa ||= normalizePageRelativeHref(image.href, sourceDir);
      } else {
        card.imageSrc ||= normalizePageRelativeHref(image.href, sourceDir);
        card.imageAlt ||= image.text ?? '';
      }
      continue;
    }

    const appLink = firstLink(token, (link: MarkdownToken) => !isReadmeHref(link.href));
    if (appLink) {
      const appLanguage = hasJapanese(`${appLink.text ?? ''}`) ? 'ja' : lastLanguage;
      if (appLanguage === 'ja') {
        card.appHrefJa ||= normalizePageRelativeHref(appLink.href, sourceDir);
      } else {
        card.appHref ||= normalizePageRelativeHref(appLink.href, sourceDir);
      }
      continue;
    }

    const text = paragraphTextWithoutLinks(token);
    if (!text) {
      continue;
    }

    lastLanguage = hasJapanese(text) ? 'ja' : 'en';
    if (lastLanguage === 'ja') {
      card.descriptionJa ||= text;
    } else {
      card.description ||= text;
    }
  }

  return card.appHref || card.appHrefJa || card.description || card.descriptionJa ? card : null;
}

function parseIntro(markdown: string): { en: string; ja: string } {
  const tokens = marked.lexer(markdown, { gfm: true });
  const paragraphs = tokens.filter((token: MarkdownToken) => token.type === 'paragraph');
  const plain = paragraphs
    .map((token) => paragraphTextWithoutLinks(token))
    .filter(Boolean)
    .filter((text) => !/^Frieve /.test(text));

  return {
    en: plain.find((text) => !hasJapanese(text)) ?? '',
    ja: plain.find((text) => hasJapanese(text)) ?? '',
  };
}

export async function getHomeData(base = '/') {
  const readmePath = path.join(workspaceRoot, 'README.md');
  const markdown = await readFile(readmePath, 'utf8');
  const tokens = marked.lexer(markdown, { gfm: true });
  const titleToken = tokens.find(
    (token: MarkdownToken) => token.type === 'heading' && token.depth === 1,
  ) as MarkdownToken | undefined;
  const rootTools = parseToolCards(markdown);
  const existingToolIds = new Set(rootTools.map((tool) => tool.id));
  const readmePages = await getReadmePages();
  const extraTools = (
    await Promise.all(
      readmePages
        .filter((page) => page.slug && !existingToolIds.has(page.slug))
        .map(async (page) => parseStandaloneToolCard(await readFile(page.filePath, 'utf8'), page.slug)),
    )
  ).filter((tool): tool is ToolCard => Boolean(tool));

  const tools = [...rootTools, ...extraTools].map((tool) => {
    const icon = resolveToolIcon(tool.id);
    return {
      ...tool,
      readmeHref: toSiteHref(tool.readmeHref, base),
      appHref: toSiteHref(tool.appHref, base),
      appHrefJa: tool.appHrefJa ? toSiteHref(tool.appHrefJa, base) : '',
      imageSrc: toSiteHref(tool.imageSrcJa || tool.imageSrc, base),
      iconSrc: icon ? toSiteHref(icon, base) : '',
    };
  });

  return {
    title: titleToken?.text ?? "Frieve's Sound Toolbox",
    intro: parseIntro(markdown),
    tools,
  };
}

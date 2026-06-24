import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { isReadmeHref, normalizeProjectHref, readmeTargetToRoute, toSiteHref } from './paths';

type ReadmePageForRender = {
  filePath: string;
  sourceDir: string;
};

function hasJapanese(text: string): boolean {
  return /[぀-ヿ㐀-鿿]/.test(text);
}

/**
 * Tool README files keep an English section on top, then a horizontal rule
 * (a line of 3+ dashes), then the Japanese translation. Split the raw markdown
 * back into those two halves so each language can be rendered independently.
 */
function splitBilingual(markdown: string): { en: string; ja: string } {
  const parts = markdown.split(/^[ \t]*-{3,}[ \t]*$/m);
  if (parts.length < 2) {
    return { en: markdown.trim(), ja: '' };
  }

  const jaStart = parts.findIndex((part) => hasJapanese(part));
  if (jaStart <= 0) {
    return { en: markdown.trim(), ja: '' };
  }

  const en = parts.slice(0, jaStart).join('\n\n---\n\n').trim();
  let ja = parts.slice(jaStart).join('\n\n---\n\n').trim();

  // README files keep the (usually English, product-name) level-1 heading only
  // atop the English section. Carry it into the Japanese half so the title
  // heading does not vanish when viewing the page in Japanese.
  if (!/^#\s/m.test(ja)) {
    const heading = en.match(/^#\s.*$/m);
    if (heading) {
      ja = `${heading[0]}\n\n${ja}`;
    }
  }

  return { en, ja };
}

async function renderMarkdownString(
  markdown: string,
  sourceDir: string,
  base: string,
): Promise<string> {
  const html = await marked.parse(markdown, {
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') {
        if (isReadmeHref(token.href)) {
          token.href = toSiteHref(readmeTargetToRoute(token.href, sourceDir), base);
          return;
        }

        const normalized = normalizeProjectHref(token.href);
        if (normalized !== token.href) {
          token.href = toSiteHref(normalized, base);
        }
      }

      if (token.type === 'image') {
        const normalized = normalizeProjectHref(token.href);
        if (normalized !== token.href) {
          token.href = toSiteHref(normalized, base);
        }
      }
    },
  });

  return String(html);
}

export async function renderMarkdownFile(page: ReadmePageForRender, base = '/'): Promise<string> {
  const markdown = await readFile(page.filePath, 'utf8');
  return renderMarkdownString(markdown, page.sourceDir, base);
}

export async function renderBilingualMarkdownFile(
  page: ReadmePageForRender,
  base = '/',
): Promise<{ en: string; ja: string }> {
  const markdown = await readFile(page.filePath, 'utf8');
  const { en, ja } = splitBilingual(markdown);

  return {
    en: en ? await renderMarkdownString(en, page.sourceDir, base) : '',
    ja: ja ? await renderMarkdownString(ja, page.sourceDir, base) : '',
  };
}

import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { isReadmeHref, normalizeProjectHref, readmeTargetToRoute, toSiteHref } from './paths';

type ReadmePageForRender = {
  filePath: string;
  sourceDir: string;
};

export async function renderMarkdownFile(page: ReadmePageForRender, base = '/'): Promise<string> {
  const markdown = await readFile(page.filePath, 'utf8');

  const html = await marked.parse(markdown, {
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') {
        if (isReadmeHref(token.href)) {
          token.href = toSiteHref(readmeTargetToRoute(token.href, page.sourceDir), base);
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

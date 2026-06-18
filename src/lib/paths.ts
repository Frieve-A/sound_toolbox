const githubPagesRoot = 'https://frieve-a.github.io/sound_toolbox/';

export function normalizeProjectHref(href: string): string {
  if (!href) {
    return href;
  }

  if (href.startsWith(githubPagesRoot)) {
    return href.slice(githubPagesRoot.length);
  }

  return href;
}

export function toSiteHref(href: string, base = '/'): string {
  if (!href) {
    return '#';
  }

  const normalized = normalizeProjectHref(href);

  if (/^(?:https?:|mailto:|tel:|#)/i.test(normalized)) {
    return normalized;
  }

  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanHref = normalized.replace(/^\.?\//, '');

  if (!cleanHref) {
    return cleanBase;
  }

  return `${cleanBase}${cleanHref}`.replace(/\/{2,}/g, '/');
}

export function readmeTargetToRoute(href: string, sourceDir = ''): string {
  const [withoutHash, hash = ''] = href.split('#');
  const suffix = hash ? `#${hash}` : '';
  const normalized = normalizeProjectHref(withoutHash).replace(/\\/g, '/').replace(/^\.\//, '');

  if (/^readme\.md$/i.test(normalized)) {
    return `${sourceDir ? `${sourceDir}/` : ''}${suffix}`;
  }

  if (/\/readme\.md$/i.test(normalized)) {
    return `${normalized.replace(/\/readme\.md$/i, '/')}${suffix}`;
  }

  return href;
}

export function isReadmeHref(href: string): boolean {
  const normalized = normalizeProjectHref(href).split('#')[0];
  return /(?:^|\/)readme\.md$/i.test(normalized);
}

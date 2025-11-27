const projectRootUrl = new URL('../../', import.meta.url);

export function resolveAssetUrl(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return '';
  }
  const normalized = relativePath.replace(/^\/+/, '');
  return new URL(normalized, projectRootUrl).href;
}

export function mapAssetUrls(paths = []) {
  if (!Array.isArray(paths)) {
    return [];
  }
  return paths.map((path) => resolveAssetUrl(path));
}


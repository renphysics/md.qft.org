/** SITE_URL includes the optional project path, as returned by configure-pages. */
export function resolveSiteUrl(value = 'https://md.qft.org') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SITE_URL must be an HTTP(S) website URL without credentials, a query, or a fragment.');
  }
  return {
    site: url.origin,
    base: `${url.pathname.replace(/\/+$/, '')}/`,
  };
}

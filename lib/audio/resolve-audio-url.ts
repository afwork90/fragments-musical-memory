/** Make public audio paths work under GitHub Pages (`./` base) and absolute hosts. */
export function resolveAudioUrl(url: string): string {
  if (!url) return url;
  if (
    url.startsWith("blob:")
    || url.startsWith("data:")
    || url.startsWith("./")
    || url.startsWith("../")
    || /^[a-z][a-z0-9+.-]*:/i.test(url)
  ) {
    return url;
  }

  // Root-absolute `/audio/...` breaks on project Pages (`/repo-name/`).
  // Relative `./audio/...` resolves from the current document URL instead.
  if (url.startsWith("/")) return `.${url}`;

  return url;
}

// Works out what to call the company, for searches and for the kit.
// Most reliable first: the name the job description uses, the site's declared
// name (og:site_name), the first part of the homepage title, the domain.

const TITLE_SEPARATOR = /\s+[|–—:·-]\s+/;

/**
 * @param {object} hints
 * @param {string | null} [hints.fromJd]  company named in the job description
 * @param {string} [hints.siteName]  og:site_name of the homepage
 * @param {string} [hints.title]  <title> of the homepage
 * @param {string} hints.url  company website
 */
export function guessCompanyName({ fromJd, siteName, title, url }) {
  if (fromJd?.trim()) return fromJd.trim();
  if (siteName?.trim()) return siteName.trim();

  const fromTitle = title?.split(TITLE_SEPARATOR)[0]?.trim();
  // "Home" or a long slogan is not a company name.
  if (fromTitle && fromTitle.length <= 30 && !/^(home|welcome)$/i.test(fromTitle)) return fromTitle;

  return nameFromDomain(url);
}

// "https://www.about.gitlab.com/" → "Gitlab"; "http://localhost:8099/acme/" → "Acme"
function nameFromDomain(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'the company';
  }
  const host = parsed.hostname;
  const isLocal = host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':');
  const label = isLocal
    ? parsed.pathname.split('/').filter(Boolean)[0]
    : host
        .split('.')
        .filter((part) => part !== 'www')
        .at(-2);
  if (!label) return 'the company';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

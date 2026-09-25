// Turns raw HTML into what the rest of the pipeline needs: the page's links,
// and its readable text without scripts, navigation or other chrome.

import * as cheerio from 'cheerio';

const SKIPPED_EXTENSIONS =
  /\.(pdf|png|jpe?g|gif|svg|webp|ico|zip|gz|mp4|mp3|webm|css|js|mjs|json|xml|rss|woff2?|ttf)$/i;

const NON_CONTENT = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'form',
  'nav',
  'footer',
  'header',
  'aside',
  '[aria-hidden="true"]',
  '[role="navigation"]',
].join(',');

const BLOCK_ELEMENTS = 'p,div,section,article,li,h1,h2,h3,h4,h5,h6,tr,dt,dd,blockquote,pre,br';

/**
 * Every followable link on the page, resolved to an absolute URL.
 * Relative links ("careers/", "../jobs") are resolved against the page URL,
 * or against <base href> when the page declares one.
 *
 * @returns {Array<{ url: string, text: string }>}  one entry per URL
 */
export function extractLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').attr('href');
  let base;
  try {
    base = baseHref ? new URL(baseHref, pageUrl) : new URL(pageUrl);
  } catch {
    base = new URL(pageUrl);
  }

  const byUrl = new Map();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href').trim();
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return;

    let url;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (SKIPPED_EXTENSIONS.test(url.pathname)) return;
    url.hash = '';

    const text = collapse(
      [$(el).text(), $(el).attr('aria-label'), $(el).attr('title')].filter(Boolean).join(' '),
    );
    const previous = byUrl.get(url.href);
    // The same URL often appears several times (logo, nav, footer); keep the
    // most descriptive anchor text.
    if (!previous || text.length > previous.text.length)
      byUrl.set(url.href, { url: url.href, text });
  });
  return [...byUrl.values()];
}

/**
 * The page's readable content.
 *
 * @returns {{ title: string, description: string, text: string, truncated: boolean }}
 */
export function extractPageContent(html, { maxChars = 15_000 } = {}) {
  const $ = cheerio.load(html);
  const title = collapse($('title').first().text()) || collapse($('h1').first().text());
  const description = collapse($('meta[name="description"]').attr('content') ?? '');

  $(NON_CONTENT).remove();
  const main = $('main').first();
  const article = $('article').first();
  const root = main.length ? main : article.length ? article : $('body');

  // Put a line break after block elements so paragraphs don't run together.
  root.find(BLOCK_ELEMENTS).each((_, el) => {
    $(el).append('\n');
  });

  const lines = root.text().split('\n').map(collapse).filter(Boolean);
  const text = lines.join('\n');

  return {
    title,
    description,
    text: text.length > maxChars ? text.slice(0, maxChars) : text,
    truncated: text.length > maxChars,
  };
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

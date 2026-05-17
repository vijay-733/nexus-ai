import { toolRegistry } from './registry.js';
import { logger }       from '../utils/logger.js';

const WEB_TIMEOUT_MS = 15_000;

// Minimal HTML-to-text extractor
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract meaningful metadata from a page
interface FetchResult {
  url:     string;
  title:   string;
  content: string;
  status:  number;
}

async function fetchUrl(url: string): Promise<FetchResult> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'NexusAI/1.0 (research bot)' },
    signal:  AbortSignal.timeout(WEB_TIMEOUT_MS),
  });

  const contentType = r.headers.get('content-type') ?? '';
  let content = '';
  let title   = '';

  if (contentType.includes('text/html')) {
    const html  = await r.text();
    const titleM = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    title   = titleM?.[1]?.trim() ?? url;
    content = htmlToText(html).slice(0, 5_000);
  } else if (contentType.includes('application/json')) {
    const json = await r.json() as unknown;
    content = JSON.stringify(json, null, 2).slice(0, 5_000);
    title   = url;
  } else {
    content = (await r.text()).slice(0, 5_000);
    title   = url;
  }

  return { url, title, content, status: r.status };
}

async function summarisePage(url: string, content: string, instruction: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const prompt    = `URL: ${url}\n\nPage content:\n${content.slice(0, 3_000)}\n\nInstruction: ${instruction}`;

  if (openaiKey) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:      'gpt-4o-mini',
        max_tokens: 600,
        messages: [
          { role: 'system', content: 'Extract and summarise the most relevant information from the provided web page.' },
          { role: 'user',   content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    });
    const d = await r.json() as { choices?: Array<{ message: { content: string } }> };
    return d.choices?.[0]?.message?.content ?? content.slice(0, 1_000);
  }

  // No LLM: return trimmed content directly
  return content.slice(0, 1_500);
}

// Register
toolRegistry.register({
  name:        'web-fetch',
  description: 'Fetch content from a URL and extract relevant information',
  cost:        2,
  handler: async (params) => {
    // params.prompt is expected to be "URL | instruction" or just a URL
    const [rawUrl, ...rest] = params.prompt.split('|').map(s => s.trim());
    const instruction       = rest.join(' ') || 'Summarise the key information';

    // Basic URL validation
    let url: string;
    try {
      url = new URL(rawUrl).toString();
    } catch {
      return {
        type:     'text',
        content:  `Invalid URL: ${rawUrl}`,
        provider: 'web-fetch',
        model:    'web-fetch',
      };
    }

    logger.info('web-tool', `fetching url=${url}`);

    try {
      const page    = await fetchUrl(url);
      const summary = await summarisePage(url, page.content, instruction);

      const content = [
        `**${page.title}**`,
        `URL: ${page.url}`,
        `Status: ${page.status}`,
        '',
        summary,
      ].join('\n');

      logger.info('web-tool', `done status=${page.status} length=${content.length}`);

      return {
        type:     'text',
        content,
        provider: 'web-fetch',
        model:    'web-fetch',
        metadata: { url, status: page.status, titleLength: page.title.length },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fetch failed';
      logger.error('web-tool', `${url}: ${msg}`);
      return {
        type:     'text',
        content:  `Failed to fetch ${url}: ${msg}`,
        provider: 'web-fetch',
        model:    'web-fetch',
      };
    }
  },
});

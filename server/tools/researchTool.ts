import { toolRegistry }             from './registry.js';
import { callPollinationsText }     from '../services/modelRouter.js';
import { logger }                   from '../utils/logger.js';

const RESEARCH_TIMEOUT_MS = 30_000;

interface ResearchResult {
  query:    string;
  summary:  string;
  sources:  string[];
  depth:    'quick' | 'standard' | 'deep';
}

async function fetchTextFromUrl(url: string, signal: AbortSignal): Promise<string> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  // Strip HTML tags for plain text extraction
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3_000);
}

// Pollinations POST-based research: uses the chat completions API
async function pollinationsResearch(
  query: string,
  depth: 'quick' | 'standard' | 'deep'
): Promise<string> {
  const system = `You are a research assistant. Provide a well-structured, factual research summary.
Format your response as:
## Summary
[2-3 sentence overview]

## Key Findings
- [Finding 1]
- [Finding 2]
- [Finding 3]

## Details
[${depth !== 'quick' ? 'Detailed analysis with supporting evidence' : 'Brief notes'}]`;

  const model = depth === 'deep' ? 'openai' : 'mistral';
  return callPollinationsText(`Research: ${query}`, system, model, RESEARCH_TIMEOUT_MS);
}

async function performResearch(
  query: string,
  depth: 'quick' | 'standard' | 'deep'
): Promise<ResearchResult> {
  const openaiKey  = process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const signal     = AbortSignal.timeout(RESEARCH_TIMEOUT_MS);

  let summary = '';

  if (openaiKey) {
    const maxTokens = depth === 'quick' ? 512 : depth === 'standard' ? 1024 : 4096;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:      'gpt-4o-mini',
        max_tokens: maxTokens,
        messages: [
          {
            role:    'system',
            content: 'You are a research assistant. Provide structured, factual research with ## Summary, ## Key Findings, ## Details sections.',
          },
          { role: 'user', content: `Research this topic thoroughly: ${query}` },
        ],
      }),
      signal,
    });
    const d = await r.json() as { choices?: Array<{ message: { content: string } }> };
    summary = d.choices?.[0]?.message?.content ?? '';
  } else if (anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: depth === 'quick' ? 512 : 1024,
        messages:   [{ role: 'user', content: `Research: ${query}` }],
      }),
      signal,
    });
    const d = await r.json() as { content?: Array<{ text: string }> };
    summary = d.content?.[0]?.text ?? '';
  } else {
    summary = await pollinationsResearch(query, depth);
  }

  // Parse structured sections
  const summaryMatch   = summary.match(/##\s*Summary\s*([\s\S]*?)(?=##|$)/i);
  const findingsMatch  = summary.match(/##\s*Key Findings\s*([\s\S]*?)(?=##|$)/i);

  return {
    query,
    summary:  summaryMatch?.[1]?.trim() ?? summary.slice(0, 500),
    sources:  findingsMatch?.[1]?.trim()
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.replace(/^-\s*/, '').trim())
      .slice(0, 5) ?? [],
    depth,
  };
}

// Register
toolRegistry.register({
  name:        'research',
  description: 'Research a topic in depth and return a structured summary with key findings',
  cost:        3,
  handler: async (params) => {
    const query = params.prompt;
    const depth = (params['depth'] as 'quick' | 'standard' | 'deep' | undefined) ?? 'standard';

    logger.info('research-tool', `query="${query.slice(0, 80)}" depth=${depth}`);

    let content: string;
    try {
      const result = await performResearch(query, depth);
      content = [
        `**Research: ${result.query}**`,
        '',
        '## Summary',
        result.summary,
        result.sources.length > 0 ? '\n## Key Findings' : '',
        ...result.sources.map(s => `- ${s}`),
      ].join('\n');
    } catch (err) {
      // Fallback: structured outline so the session never returns empty
      logger.warn('research-tool', `provider failed: ${err instanceof Error ? err.message : err} — using fallback`);
      content = `**Research: ${query}**\n\n## Summary\nResearch on this topic covers key concepts, recent developments, and practical implications.\n\n## Key Findings\n- Multiple methodologies exist, each with distinct trade-offs\n- The field has evolved significantly in the past 2–3 years\n- Both theoretical understanding and practical application are important\n\n> **Note:** AI provider unavailable — add \`OPENAI_API_KEY\` or \`GEMINI_API_KEY\` for full research results.`;
    }

    logger.info('research-tool', `done length=${content.length}`);

    return {
      type:     'text',
      content,
      provider: params.provider ?? 'research',
      model:    'research-engine',
    };
  },
});

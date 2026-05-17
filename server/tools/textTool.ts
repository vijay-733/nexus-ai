import { toolRegistry, type ToolParams, type ToolResult } from './registry.js';
import {
  callOpenAIText, callGeminiText, callPollinationsText,
} from '../services/modelRouter.js';
import { logger } from '../utils/logger.js';

const SYS_DEFAULT = `You are an expert AI assistant. Produce comprehensive, well-structured responses.

FORMAT: Use ## headings, **bold** for key terms, bullet/numbered lists, fenced code blocks (\`\`\`lang).
QUALITY: Be specific and concrete. Explain the "why". End with actionable takeaways.
DEPTH: Match the request — brief question gets a concise answer; complex request gets thorough coverage.`;

const SYS_CODE = `You are an expert software engineer. Write production-quality code with clear explanations.

FORMAT: Always use fenced code blocks with the correct language tag. Use ## sections.
CONTENT: Include complete, runnable implementations. Add inline comments for non-obvious logic.
QUALITY: Handle edge cases. Follow best practices. Briefly explain architectural decisions.`;

const SYS_WRITING = `You are an expert writer producing polished, well-researched content.

FORMAT: Use ## for chapters/sections, ### for subsections. Bold key terms. Use lists for enumerated items.
QUALITY: Write in a clear, authoritative voice. Support claims with specifics. Avoid clichés and filler.
STRUCTURE: Opening hook → core content with evidence → practical takeaways → conclusion.`;

const SYS_ANALYSIS = `You are a senior analyst producing rigorous, evidence-based analysis.

FORMAT: Use ## sections (Executive Summary, Analysis, Findings, Recommendations). Use tables where useful.
QUALITY: Be precise. Distinguish facts from interpretation. Provide concrete evidence.
STRUCTURE: Lead with the key insight, then support it with analysis. End with specific recommendations.`;

function pickSystemPrompt(prompt: string): string {
  const t = prompt.toLowerCase();
  if (/\b(code|function|class|api|implement|script|algorithm|typescript|python|javascript|sql|endpoint|component|module)\b/.test(t))
    return SYS_CODE;
  if (/\b(blog|article|post|essay|write|draft|content|story|guide|tutorial|explain)\b/.test(t))
    return SYS_WRITING;
  if (/\b(analyze|analysis|compare|evaluate|assess|review|strategy|report|findings|competitive|market|landscape)\b/.test(t))
    return SYS_ANALYSIS;
  return SYS_DEFAULT;
}

const POLL_MODELS     = ['openai', 'mistral', 'llama'] as const;
const POLL_TIMEOUT_MS = 12_000;  // 12s × 3 models = 36s max — within 65s agent deadline

// ── Inline fallback helpers ───────────────────────────────────────────────────

function detectLang(task: string): string {
  const t = task.toLowerCase();
  if (/\bpython\b/.test(t))                   return 'python';
  if (/\bjavascript\b|\bnode\.?js\b/.test(t)) return 'javascript';
  if (/\btypescript\b/.test(t))               return 'typescript';
  if (/\bgolang\b|\bgo\b/.test(t))            return 'go';
  if (/\bjava\b/.test(t))                     return 'java';
  if (/\brust\b/.test(t))                     return 'rust';
  if (/\bsql\b/.test(t))                      return 'sql';
  if (/\bbash\b|\bshell\b/.test(t))           return 'bash';
  return 'typescript';
}

function topicOf(task: string): string {
  return task
    .replace(/^(write|create|build|generate|make|develop|implement|design|explain|analyze|research|list|give me|show me|help|draft|compose|produce)\s+/i, '')
    .replace(/^(a|an|the|some|me|us|my|your)\s+/i, '')
    .split(/[.!?]|,?\s+(?:providing|including|covering|in exactly|in \d+|with explanations?|using|that should|which should|ensuring|and then)\b/i)[0]
    .trim()
    .slice(0, 60) || task.slice(0, 60);
}

function langScaffold(lang: string, topic: string): string {
  const fn = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28) || 'execute';
  switch (lang) {
    case 'python':
      return `\`\`\`python\ndef ${fn}(data):\n    """${topic.slice(0, 55)}"""\n    if data is None:\n        raise ValueError("Input required")\n    # Core logic\n    return None\n\n\nif __name__ == "__main__":\n    print(${fn}(None))\n\`\`\``;
    case 'javascript':
      return `\`\`\`javascript\nasync function ${fn}(data) {\n  if (!data) throw new Error('Input required');\n  // Core logic\n  return { success: true, data: null };\n}\n\nmodule.exports = { ${fn} };\n\`\`\``;
    case 'go':
      return `\`\`\`go\npackage main\n\nimport "fmt"\n\nfunc ${fn}(input interface{}) (interface{}, error) {\n\tif input == nil {\n\t\treturn nil, fmt.Errorf("input required")\n\t}\n\treturn nil, nil\n}\n\`\`\``;
    case 'sql':
      return `\`\`\`sql\n-- ${topic}\nSELECT id, name, data\nFROM   items\nWHERE  name IS NOT NULL\nORDER  BY created_at DESC\nLIMIT  100;\n\`\`\``;
    default: {
      const Cap = fn.charAt(0).toUpperCase() + fn.slice(1);
      return `\`\`\`typescript\ninterface ${Cap}Input { /* your input types */ }\ninterface ${Cap}Output { success: boolean; data?: unknown; error?: string; }\n\nasync function ${fn}(input: ${Cap}Input): Promise<${Cap}Output> {\n  // 1. Validate inputs\n  // 2. Core logic\n  // 3. Return result\n  return { success: true };\n}\n\`\`\``;
    }
  }
}

// Structured fallback when all AI providers are unreachable.
// Generates contextual content using the actual task text — never generic placeholders.
function inlineFallback(task: string): string {
  const t     = task.toLowerCase();
  const topic = topicOf(task);
  const note  = `\n\n> **Note:** AI provider unavailable — add \`OPENAI_API_KEY\` or \`GEMINI_API_KEY\` to \`.env\` for full AI responses.\n`;

  if (/\blist\b|ideas|brainstorm|suggest|recommend|top \d|best \d|give me \d/.test(t)) {
    return `# ${task}${note}\n## Top Recommendations for ${topic}\n\n1. **The Foundation approach** — Establish core principles before optimizing specifics. Highest long-term ROI.\n2. **The Iterative method** — Start minimal, gather feedback, improve rapidly. Reduces risk.\n3. **The Systems lens** — Treat ${topic} as part of a larger ecosystem, not in isolation.\n4. **The Data-driven path** — Instrument early; decide based on evidence rather than assumptions.\n5. **The Community approach** — Leverage existing work before building from scratch.\n\n## How to Choose\n- Start with the option that gives you the fastest learning loop\n- Prefer reversible decisions early; lock in when confidence is high\n\n## Key Takeaways\n- No single approach is universally best — context determines the right choice\n- Revisit the decision as you gain more information`;
  }
  if (/research|summarize|analyze|explain|overview|survey|compare|review|study|investigate|benefit|advantage|disadvantage|data|report|document|competitive|market/.test(t)) {
    return `# Research: ${task}${note}\n## Background & Context\n**${topic}** is an important area with significant practical implications. Understanding the foundational concepts is essential before diving into specifics.\n\n## Current State\n- **Leading approaches**: Multiple methodologies exist for ${topic}, each with distinct trade-offs\n- **Recent developments**: The field has evolved significantly in the past 2–3 years\n- **Key patterns**: Both academic research and industry practitioners are refining best practices\n\n## Core Findings\n1. **Fundamentals**: Foundational principles underlying ${topic} that practitioners must understand\n2. **Common patterns**: Established approaches proven reliable across many contexts\n3. **Emerging trends**: Newer developments reshaping how experts think about ${topic}\n\n## Practical Implications\nUnderstanding ${topic} enables better decision-making. Apply insights to reduce costs and avoid common pitfalls.\n\n## Key Takeaways\n- Build foundational knowledge first; specialization follows naturally\n- Practical application requires adapting theory to your specific context`;
  }
  if (/strategy|plan|roadmap|approach|how to|steps to|guide|classify|matrix|competitive/.test(t)) {
    return `# ${task}${note}\n## Executive Summary\nA clear strategy for **${topic}** requires understanding current state, desired outcome, and the gap between them.\n\n## Phase 1: Foundation\n- Audit current state; document what exists for ${topic}\n- Define measurable KPIs before taking action\n- Identify 2–3 quick wins that build momentum\n\n## Phase 2: Core Execution\n- Address the highest-impact bottleneck in ${topic} first\n- Build sustainable systems and processes\n- Create feedback loops to catch problems early\n\n## Phase 3: Optimization\n- Review metrics weekly; adjust monthly\n- Scale what works; eliminate what doesn't\n\n## Key Takeaways\n- Strategy without execution is just a wish list\n- Measure early and often — data beats intuition`;
  }
  if (/\b(code|function|class|api|script|implement|build|program|algorithm|endpoint|typescript|javascript|python|sql)\b/.test(t)) {
    const lang = detectLang(task);
    return `# Implementation: ${task}${note}\n## Overview\nImplementation plan for **${topic}** in **${lang}**.\n\n## Core Structure\n\n${langScaffold(lang, topic)}\n\n## Requirements\n- Input validation with descriptive errors\n- Graceful error handling — no silent failures\n- Single-responsibility functions for testability\n\n## Key Takeaways\n- Start with the data model, then build logic outward\n- Make it work → make it right → make it fast`;
  }
  return `## ${task}${note}\n### Overview\n**${topic}** — here is a structured framework for approaching this.\n\n### Core Considerations\n- **What**: Define the scope of ${topic} precisely\n- **Why**: Understand motivations and goals — they shape every decision\n- **How**: Select the approach that fits your constraints\n- **When**: Sequencing matters as much as the approach itself\n\n### Recommended Approach\n1. Define what success looks like for ${topic} — make it measurable\n2. Identify the top 2–3 constraints you must work within\n3. Build the smallest version that proves the concept\n4. Establish a feedback loop before scaling\n\n### Key Takeaways\n- Clarity of purpose is the prerequisite for good execution\n- Done is better than perfect — ship, learn, improve`;
}

async function run(p: ToolParams): Promise<ToolResult> {
  const ok  = process.env.OPENAI_API_KEY?.trim();
  const gk  = process.env.GEMINI_API_KEY?.trim();
  const sys = (p.systemPrompt as string | undefined) ?? pickSystemPrompt(p.prompt);

  logger.info('text-tool', `provider=${p.provider} hasOpenAI=${!!ok} hasGemini=${!!gk}`);

  // 1 — OpenAI
  if (ok) {
    try {
      const text = await callOpenAIText(p.prompt, sys, ok);
      if (text) return { type: 'text', content: text, provider: 'openai', model: 'gpt-4o-mini' };
    } catch (err) {
      logger.warn('text-tool', `OpenAI failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2 — Gemini
  if (gk) {
    try {
      const text = await callGeminiText(p.prompt, sys, gk);
      if (text) return { type: 'text', content: text, provider: 'gemini', model: 'gemini-2.5-flash' };
    } catch (err) {
      logger.warn('text-tool', `Gemini failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 3 — Pollinations free tier (model rotation)
  for (const model of POLL_MODELS) {
    try {
      const text = await callPollinationsText(p.prompt, sys, model, POLL_TIMEOUT_MS);
      if (text) return { type: 'text', content: text, provider: 'pollinations', model };
    } catch (err) {
      logger.warn('text-tool', `pollinations/${model} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 4 — Inline structured fallback (never returns empty)
  logger.warn('text-tool', 'all providers failed — using inline fallback');
  return { type: 'text', content: inlineFallback(p.prompt), provider: 'fallback', model: 'none' };
}

toolRegistry.register({
  name:        'text-generation',
  description: 'Generate text using GPT-4o-mini, Gemini, or Pollinations. Falls back to inline templates when all providers fail.',
  cost:        1,
  handler:     run,
});

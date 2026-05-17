// Text Worker Agent
// Provider priority: OpenAI → Gemini → Pollinations POST (free tier).
// Built-in no-API fallback guarantees a useful response even when all
// network providers fail, so tasks never return zero output.

import { callOpenAIText, callGeminiText, callPollinationsText } from '../../services/modelRouter.js';
import { logger } from '../../utils/logger.js';

const POLL_MODELS     = ['openai', 'mistral', 'llama'] as const;
// 12s per model × 3 = 36s max — comfortably within the 65s overall deadline
const POLL_TIMEOUT_MS = 12_000;

export interface TextAgentInput {
  stepId:        string;
  task:          string;
  context:       string;
  provider:      string;
  systemPrompt?: string;
  signal?:       AbortSignal;   // overall task deadline — aborts provider calls early
}

export interface TextAgentOutput {
  stepId:     string;
  content:    string;
  provider:   string;
  durationMs: number;
  error?:     string;
}

const BASE_SYSTEM = `You are an expert AI assistant producing high-quality, well-structured responses.

RESPONSE GUIDELINES:
- Use clear markdown headings (##, ###) to organize sections
- Include concrete examples, data points, and specific details — never vague generalities
- For technical tasks: provide working code with explanations
- For research/analysis: cover background, current state, key insights, and actionable takeaways
- For creative/content tasks: deliver polished, publication-ready output
- Minimum response depth: 3-5 substantive paragraphs or equivalent structured content
- End with a "## Key Takeaways" or "## Next Steps" section where appropriate

Be thorough, accurate, and genuinely useful.`;

// ── Inline fallback helpers ───────────────────────────────────────────────────

function detectLanguage(task: string): string {
  const t = task.toLowerCase();
  if (/\bpython\b/.test(t))                   return 'python';
  if (/\bjavascript\b|\bnode\.?js\b/.test(t)) return 'javascript';
  if (/\btypescript\b/.test(t))               return 'typescript';
  if (/\bgolang\b|\bgo\b/.test(t))            return 'go';
  if (/\bjava\b/.test(t))                     return 'java';
  if (/\brust\b/.test(t))                     return 'rust';
  if (/\bruby\b/.test(t))                     return 'ruby';
  if (/\bphp\b/.test(t))                      return 'php';
  if (/\bc#\b|\bcsharp\b/.test(t))            return 'csharp';
  if (/\bsql\b/.test(t))                      return 'sql';
  if (/\bbash\b|\bshell\b/.test(t))           return 'bash';
  return 'typescript';
}

function extractTopic(task: string): string {
  return task
    .replace(/^(write|create|build|generate|make|develop|implement|design|explain|analyze|research|list|give me|show me|help|draft|compose|produce)\s+/i, '')
    .replace(/^(a|an|the|some|me|us|my|your)\s+/i, '')
    // Split at sentence ends or at clause-introducing phrases (comma + providing/including/etc.)
    .split(/[.!?]|,?\s+(?:providing|including|covering|in exactly|in \d+|with explanations?|using|that should|which should|ensuring|and then)\b/i)[0]
    .trim()
    .slice(0, 60) || task.slice(0, 60);
}

function codeScaffold(lang: string, topic: string): string {
  const fn = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'execute';
  switch (lang) {
    case 'python':
      return `def ${fn}(data):\n    """${topic.slice(0, 60)}"""\n    # 1. Validate inputs\n    if data is None:\n        raise ValueError("Input required")\n    # 2. Core logic\n    result = None\n    # 3. Return result\n    return result\n\n\nif __name__ == "__main__":\n    output = ${fn}(None)\n    print(output)`;
    case 'javascript':
      return `async function ${fn}(data) {\n  // 1. Validate inputs\n  if (data === undefined || data === null) {\n    throw new Error('Input required');\n  }\n  // 2. Core logic\n  const result = null;\n  // 3. Return result\n  return { success: true, data: result };\n}\n\nmodule.exports = { ${fn} };`;
    case 'go':
      return `package main\n\nimport (\n\t"errors"\n\t"fmt"\n)\n\nfunc ${fn}(input interface{}) (interface{}, error) {\n\tif input == nil {\n\t\treturn nil, errors.New("input required")\n\t}\n\t// Core logic\n\treturn nil, nil\n}\n\nfunc main() {\n\tresult, err := ${fn}(nil)\n\tif err != nil {\n\t\tfmt.Printf("Error: %v\\n", err)\n\t\treturn\n\t}\n\tfmt.Println(result)\n}`;
    case 'java':
      return `public class Solution {\n    public Object ${fn}(Object input) {\n        if (input == null) {\n            throw new IllegalArgumentException("Input required");\n        }\n        // Core logic\n        return null;\n    }\n\n    public static void main(String[] args) {\n        Solution sol = new Solution();\n        System.out.println(sol.${fn}("example"));\n    }\n}`;
    case 'rust':
      return `fn ${fn}(input: &str) -> Result<String, Box<dyn std::error::Error>> {\n    if input.is_empty() {\n        return Err("Input required".into());\n    }\n    // Core logic\n    Ok(String::new())\n}\n\nfn main() {\n    match ${fn}("example") {\n        Ok(result) => println!("{}", result),\n        Err(e) => eprintln!("Error: {}", e),\n    }\n}`;
    case 'sql':
      return `-- ${topic}\nCREATE TABLE IF NOT EXISTS items (\n  id   SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  data JSONB,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);\n\n-- Query\nSELECT id, name, data\nFROM   items\nWHERE  name IS NOT NULL\nORDER  BY created_at DESC\nLIMIT  100;`;
    default: {
      const Cap = fn.charAt(0).toUpperCase() + fn.slice(1);
      return `interface ${Cap}Input {\n  // Define your input types here\n}\n\ninterface ${Cap}Output {\n  success: boolean;\n  data?: unknown;\n  error?: string;\n}\n\nasync function ${fn}(input: ${Cap}Input): Promise<${Cap}Output> {\n  // 1. Validate inputs\n  // 2. Core logic\n  // 3. Return result\n  return { success: true };\n}`;
    }
  }
}

// Inline fallback: structured response when all AI providers are unreachable.
// Returns contextual content based on the actual task so sessions never come back empty.
function inlineFallback(task: string): string {
  const t     = task.toLowerCase();
  const topic = extractTopic(task);
  // Priority order: list/research/content before code to avoid false positives
  const isList     = /\blist\b|ideas|brainstorm|suggest|recommend|top \d|best \d|give me \d/.test(t);
  const isResearch = /research|summarize|analyze|explain|overview|survey|compare|review|study|investigate|benefit|advantage|disadvantage/.test(t);
  const isContent  = /blog|article|post|essay|draft|newsletter|copy|description|bio/.test(t);
  const isStrategy = /strategy|plan|roadmap|approach|how to|steps to|guide|tutorial/.test(t);
  const isCode     = /\b(code|function|class|api|script|implement|build|program|algorithm|endpoint|typescript|javascript|python|sql)\b/.test(t);

  const note = `\n\n> **Note:** AI provider unavailable — add \`OPENAI_API_KEY\` or \`GEMINI_API_KEY\` to the server \`.env\` file for full AI responses. This is a structured outline.\n`;

  if (isList) {
    return `# ${task}
${note}
## Top Recommendations for ${topic}

1. **The Foundation approach** — Establish core principles before optimizing specifics. Highest long-term ROI for ${topic}.
2. **The Iterative method** — Start minimal, gather feedback, improve rapidly. Reduces risk and accelerates learning.
3. **The Systems lens** — Treat ${topic} as part of a larger ecosystem. Optimizing in isolation often creates new bottlenecks.
4. **The Data-driven path** — Instrument early, decide based on evidence rather than assumptions.
5. **The Community approach** — Leverage existing solutions and community knowledge before building from scratch.

## Evaluation Criteria
- **Impact vs effort**: Rank options by (expected outcome ÷ implementation cost)
- **Reversibility**: Prefer approaches you can undo if they don't work
- **Dependencies**: Identify what each option requires that you don't yet have

## Key Takeaways
- No single option is universally best — context determines the right choice
- Start with the approach that gives you the fastest learning loop
- Revisit the decision as you gain more information`;
  }

  if (isResearch) {
    return `# Research: ${task}
${note}
## Background & Context
**${topic}** is an important area with significant practical implications. A solid understanding requires examining both the theoretical foundations and real-world applications.

## Current State
- **Leading approaches**: Multiple methodologies exist for ${topic}, each with distinct trade-offs between simplicity, performance, and maintainability
- **Recent developments**: The field has evolved significantly, with new frameworks and techniques emerging in the past 2–3 years
- **Key considerations**: Both academic research and industry practitioners are actively refining best practices

## Core Concepts
1. **Fundamentals**: The foundational principles underlying ${topic} that any practitioner must understand
2. **Common patterns**: Established approaches that have proven reliable across many contexts
3. **Emerging trends**: Newer developments that are reshaping how experts think about ${topic}

## Practical Implications
Understanding ${topic} enables better decision-making in related domains. The insights can be directly applied to improve outcomes, reduce costs, and avoid common pitfalls.

## Challenges
- Balancing theoretical ideals against practical constraints
- Keeping pace with rapid evolution in the space
- Applying general principles to context-specific problems

## Key Takeaways
- Build foundational knowledge first; specialization follows naturally
- Practical application requires adapting theory to your specific context
- The best practitioners combine deep domain knowledge with cross-disciplinary thinking`;
  }

  if (isContent) {
    return `# ${task}
${note}
## Introduction
**${topic}** is more relevant than ever — yet most coverage barely scratches the surface. This piece goes deeper: concrete insights, real frameworks, and actionable guidance you can apply immediately.

## The Core Challenge
Most people approach ${topic} by focusing on the obvious surface-level aspects. The real leverage, however, lies in understanding the underlying dynamics that most practitioners overlook.

## A Framework That Works

### Step 1: Establish the Foundation
Before anything else, get clear on what success looks like for ${topic}. Define it specifically and measurably — vague goals produce vague results.

### Step 2: Build the Core
Apply the 80/20 principle: identify the 20% of inputs that produce 80% of the value. For ${topic}, this usually means focusing on [the highest-leverage activities] first.

### Step 3: Refine and Scale
Once the foundation is solid, layer in optimizations. This is where most people start, which is why they get mediocre results.

## Common Pitfalls to Avoid
- **Premature optimization**: Fixing details before the core is working
- **Complexity bias**: Adding components because they seem sophisticated
- **Metric confusion**: Measuring what's easy rather than what matters

## Conclusion
The difference between average and excellent results in ${topic} comes down to ruthless prioritization and consistent execution. Start with the foundation, prove it works, then scale what's working.

## Key Takeaways
- Lead with fundamentals; sophistication is earned, not assumed
- Concrete examples beat abstract advice every time
- Make the next step obvious and achievable`;
  }

  if (isStrategy) {
    return `# ${task}
${note}
## Executive Summary
A clear, actionable strategy for **${topic}** requires understanding the current state, the desired outcome, and the specific gap between them. This framework addresses all three.

## Phase 1: Foundation (Week 1–2)
- **Audit current state**: Document what exists for ${topic}, what works, and what doesn't
- **Define success metrics**: Establish measurable KPIs before taking any action
- **Identify quick wins**: 2–3 actions that deliver immediate value and build momentum

## Phase 2: Core Execution (Week 3–8)
- **Priority 1**: Address the highest-impact bottleneck in ${topic} first
- **Priority 2**: Build the systems and processes for sustainable progress
- **Priority 3**: Create feedback loops to catch problems early

## Phase 3: Optimization (Ongoing)
- Review metrics weekly; recalibrate monthly
- Document lessons learned after each milestone
- Scale what works; cut what doesn't

## Risk Register
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Resource constraints | Medium | High | Phase deliverables; prioritize ruthlessly |
| Stakeholder misalignment | Low | High | Weekly syncs; shared visibility dashboard |
| Scope creep | High | Medium | Written scope; change control process |

## Key Takeaways
- Strategy without execution is just a wish list
- Measure early and often — data beats intuition
- Small consistent actions compound; sporadic big efforts rarely do`;
  }

  if (isCode) {
    const lang = detectLanguage(task);
    const scaffold = codeScaffold(lang, topic);
    return `# Implementation: ${task}
${note}
## Overview
Implementation plan for **${topic}** in **${lang}**. The scaffold below provides a working starting point with proper structure, error handling, and extensibility.

## Implementation

\`\`\`${lang}
${scaffold}
\`\`\`

## Requirements & Design
- **Input validation**: Reject invalid inputs early with descriptive errors
- **Error handling**: Catch and surface failures clearly — don't swallow exceptions
- **Single responsibility**: Each function does one thing well
- **Testability**: Pure functions where possible; inject dependencies

## Testing Strategy
\`\`\`${lang === 'python' ? 'python' : lang === 'javascript' ? 'javascript' : 'typescript'}
// Unit test outline for ${topic}
// Test 1: happy path with valid input
// Test 2: edge case — empty/null input
// Test 3: boundary conditions
// Test 4: error propagation
\`\`\`

## Next Steps
1. Fill in the core logic in the scaffold above
2. Add input validation for your specific data types
3. Write tests before adding complexity
4. Document the public API with docstrings/JSDoc

## Key Takeaways
- Start with the data model, then build logic outward
- Make it work → make it right → make it fast
- Test edge cases early; they're cheapest to fix now`;
  }

  return `## ${task}
${note}
### Overview
**${topic}** requires a clear framework. Here's a structured approach to thinking through the key aspects.

### Core Considerations
- **What**: Define the scope of ${topic} precisely before diving into details
- **Why**: Understand the underlying motivations and goals — they shape every decision
- **How**: Select the approach that best fits your constraints and context
- **When**: Sequencing and timing matter as much as the approach itself

### Recommended Approach
1. **Define success**: What does "done" look like for ${topic}? Make it measurable.
2. **Identify constraints**: What are the non-negotiable limitations? Work within them.
3. **Build minimally**: Ship the smallest version that proves the concept, then iterate.
4. **Measure and adapt**: Establish your feedback loop before scaling.

### Potential Challenges
- Scope expansion without corresponding resource increase
- Underestimating integration and coordination complexity
- Neglecting the human and adoption side of technical decisions

### Key Takeaways
- Clarity of purpose is the prerequisite for good execution on ${topic}
- Done is better than perfect — ship, learn, improve
- Document decisions and the reasoning behind them while context is fresh`;
}

export async function runTextAgent(input: TextAgentInput): Promise<TextAgentOutput> {
  const t0 = Date.now();
  const ok = process.env.OPENAI_API_KEY?.trim();
  const gk = process.env.GEMINI_API_KEY?.trim();

  const system = input.systemPrompt ?? BASE_SYSTEM;
  // Inject prior step context into the user prompt (not system), so the LLM treats
  // it as data rather than instructions. Keeps system prompts clean.
  const userPrompt = input.context?.trim()
    ? `Prior step context:\n${input.context.slice(0, 2_500)}\n\n---\n\nYour task: ${input.task}`
    : input.task;

  logger.info('text-agent', `[${input.stepId}] task="${input.task.slice(0, 80)}" provider=${input.provider}`);

  try {
    let content = '';

    // 1 — OpenAI (if key present)
    if (ok) {
      content = await callOpenAIText(userPrompt, system, ok);

    // 2 — Gemini (if key present)
    } else if (gk) {
      content = await callGeminiText(userPrompt, system, gk);

    // 3 — Pollinations POST (free tier), model rotation
    } else {
      let lastErr: Error = new Error('All free-tier providers failed');
      for (const model of POLL_MODELS) {
        if (input.signal?.aborted) break;   // overall deadline already passed
        try {
          content = await callPollinationsText(userPrompt, system, model, POLL_TIMEOUT_MS, input.signal);
          if (content) break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          // Only stop trying models when the OVERALL deadline fired.
          // Per-model TimeoutError has name='TimeoutError' (not AbortError) and
          // its message contains "aborted" — matching that would skip remaining models.
          if (input.signal?.aborted) break;
          logger.warn('text-agent', `[${input.stepId}] pollinations/${model}: ${lastErr.message}`);
        }
      }
      // 4 — Inline fallback so session never returns empty-handed
      if (!content) {
        logger.warn('text-agent', `[${input.stepId}] all providers failed — using inline fallback`);
        content = inlineFallback(input.task);
      }
    }

    logger.info('text-agent', `[${input.stepId}] done length=${content.length}`);
    return { stepId: input.stepId, content, provider: ok ? 'openai' : gk ? 'gemini' : 'pollinations', durationMs: Date.now() - t0 };

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Text agent execution failed';
    logger.error('text-agent', `[${input.stepId}] ${msg}`);
    // Even on unexpected error, return fallback content so the session completes
    const fallback = inlineFallback(input.task);
    return { stepId: input.stepId, content: fallback, provider: 'fallback', durationMs: Date.now() - t0 };
  }
}

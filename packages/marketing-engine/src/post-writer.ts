import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export interface UserProfileContext {
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  brandVoice?: string | null;
  contentPillars?: Array<{ name: string; description: string }> | null;
  targetAudience?: string | null;
  salesModel?: string | null;
}

export interface SignalContext {
  id: string;
  headline: string;
  summary?: string | null;
  source: string;
}

export interface ConceptContext {
  id: string;
  title: string;
  body?: string | null;
  tags?: string[];
}

export type ContextUsed =
  | { type: 'signal'; id: string; label: string }
  | { type: 'concept'; id: string; label: string };

export interface GeneratedPost {
  content: string;
  pillar: string;
  reasoning: string;
  contextUsed?: ContextUsed;
}

const DEFAULT_PILLARS = [
  { name: 'Business lessons', description: 'Real lessons from building a business' },
  { name: 'Entrepreneurship mindset', description: 'Mental frameworks for founders' },
  { name: 'LinkedIn growth', description: 'Tips for growing an audience and network' },
];

/**
 * Generates a LinkedIn post draft using the user's brand profile and optional context.
 * Falls back to sensible defaults when profile fields are missing.
 */
export async function generateLinkedInPost(
  profile: UserProfileContext | null | undefined,
  apiKey: string,
  signal?: SignalContext,
  concept?: ConceptContext
): Promise<GeneratedPost> {
  const client = new Anthropic({ apiKey });
  const ctx = profile ?? {};

  const pillars =
    ctx.contentPillars && ctx.contentPillars.length > 0
      ? ctx.contentPillars
      : DEFAULT_PILLARS;

  const selectedPillar = pillars[Math.floor(Math.random() * pillars.length)];

  const pillarsList = pillars
    .map((p) => `• ${p.name}: ${p.description}`)
    .join('\n');

  // Build optional context section
  let contextSection = '';
  if (signal) {
    contextSection = `
INSPIRATION — write about this signal/trend (this takes priority over the pillar above):
- Headline: ${signal.headline}
- Source type: ${signal.source}${signal.summary ? `\n- Summary: ${signal.summary}` : ''}

Make the post feel timely and directly connected to this signal.`;
  } else if (concept) {
    contextSection = `
INSPIRATION — expand this concept into a LinkedIn post (this takes priority over the pillar above):
- Concept title: ${concept.title}${concept.body ? `\n- Details: ${concept.body}` : ''}${concept.tags && concept.tags.length > 0 ? `\n- Tags: ${concept.tags.join(', ')}` : ''}

Build the post around this concept/idea.`;
  }

  const prompt = `You are a ghostwriter helping an Australian entrepreneur write a high-performing LinkedIn post.

USER PROFILE:
- Industry: ${ctx.industry ?? 'entrepreneurship'}
- Headline: ${ctx.headline ?? 'Business owner'}
- Bio: ${ctx.bio ?? 'Building a business in Australia'}
- Brand voice: ${ctx.brandVoice ?? 'Authentic, direct, value-first. Conversational, not corporate.'}
- Target audience: ${ctx.targetAudience ?? 'Australian entrepreneurs and small business owners'}
- Sales model: ${ctx.salesModel ?? 'services'}
- Content pillars:
${pillarsList}
${contextSection}
WRITE ONE LINKEDIN POST${signal || concept ? ' inspired by the INSPIRATION above' : ` about the topic: "${selectedPillar.name}" — ${selectedPillar.description}`}

FORMAT (follow exactly):
Line 1: A strong hook — one sentence that makes someone stop scrolling. Use a question, bold statement, or surprising fact. Max 15 words.
[blank line]
3–5 short paragraphs of 1–3 sentences each. Tell a story or share a lesson. Keep it punchy.
[blank line]
One clear call-to-action line — ask a question to invite comments or tell readers what to do next.
[blank line]
3 relevant hashtags on one line, e.g. #LinkedIn #Entrepreneurship #Australia

RULES:
- First person, conversational Australian English
- No corporate jargon or buzzwords
- Total 150–250 words
- The hook must feel real and human, not clickbait

After the post, add exactly one line:
REASONING: [one sentence explaining why this topic will resonate with their audience right now]`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw =
    response.content[0].type === 'text' ? response.content[0].text : '';

  const reasoningMatch = raw.match(/REASONING:\s*(.+)$/m);
  const reasoning = reasoningMatch
    ? reasoningMatch[1].trim()
    : 'Matches your content pillars and target audience.';
  const content = raw.replace(/\n*REASONING:.+$/m, '').trim();

  const contextUsed: ContextUsed | undefined = signal
    ? { type: 'signal', id: signal.id, label: signal.headline }
    : concept
    ? { type: 'concept', id: concept.id, label: concept.title }
    : undefined;

  return {
    content,
    pillar: signal || concept ? (signal ? `Signal: ${signal.source}` : 'Concept') : selectedPillar.name,
    reasoning,
    contextUsed,
  };
}

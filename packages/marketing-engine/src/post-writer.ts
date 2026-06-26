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

export interface GeneratedPost {
  content: string;
  pillar: string;
  reasoning: string;
}

const DEFAULT_PILLARS = [
  { name: 'Business lessons', description: 'Real lessons from building a business' },
  { name: 'Entrepreneurship mindset', description: 'Mental frameworks for founders' },
  { name: 'LinkedIn growth', description: 'Tips for growing an audience and network' },
];

/**
 * Generates a LinkedIn post draft using the user's brand profile.
 * Falls back to sensible defaults when profile fields are missing.
 */
export async function generateLinkedInPost(
  profile: UserProfileContext | null | undefined,
  apiKey: string
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

WRITE ONE LINKEDIN POST about the topic: "${selectedPillar.name}" — ${selectedPillar.description}

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

  return {
    content,
    pillar: selectedPillar.name,
    reasoning,
  };
}

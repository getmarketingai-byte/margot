/**
 * Message template system.
 * Templates are stored as env vars so the founder can update without redeployment.
 * Fallback to hardcoded defaults if env vars not set.
 */

interface ProspectContext {
  firstName: string
  company: string
  title?: string
  industry?: string
}

function personalize(template: string, ctx: ProspectContext): string {
  return template
    .replace(/\{\{first_name\}\}/g, ctx.firstName || 'there')
    .replace(/\{\{company\}\}/g, ctx.company || 'your company')
    .replace(/\{\{title\}\}/g, ctx.title || '')
    .replace(/\{\{industry\}\}/g, ctx.industry || '')
}

/**
 * Connection request note (max 300 chars for LinkedIn).
 * Set CONNECTION_REQUEST_TEMPLATE env var to override.
 */
export function getConnectionMessage(ctx: ProspectContext): string {
  const template =
    process.env.CONNECTION_REQUEST_TEMPLATE ||
    "Hi {{first_name}}, noticed you're running marketing at {{company}} — always great to connect with fellow marketers. We've been building AI-assisted marketing tools for SMBs and I'd love to swap notes. Looking forward to connecting!"

  const msg = personalize(template, ctx)
  // LinkedIn hard limit: 300 chars for connection note
  return msg.slice(0, 300)
}

/**
 * Follow-up DM after connection is accepted.
 * Set FOLLOWUP_DM_TEMPLATE env var to override.
 */
export function getDmMessage(ctx: ProspectContext): string {
  const template =
    process.env.FOLLOWUP_DM_TEMPLATE ||
    "Hey {{first_name}}, thanks for connecting! Quick question — how are you handling content and lead gen at {{company}} right now? We built a system that sets up AI-assisted marketing in under a week for SMBs: content calendar, outreach sequences, and email nurture — all configured to your business for a one-time $149 setup.\n\nIf that sounds interesting, you can get started here: https://buy.stripe.com/cNi8wR0wZd8lePh01cbsc00\n\nEither way, keen to stay connected!"

  return personalize(template, ctx)
}

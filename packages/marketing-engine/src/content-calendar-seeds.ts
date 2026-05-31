/**
 * Australian-market content calendar seeds for Margot.
 * Industry-specific content pillars and posting cadences.
 */

export interface ContentPillar {
  name: string;
  description: string;
  exampleTopics: string[];
  frequency: "weekly" | "fortnightly" | "monthly";
}

export interface IndustryCalendarSeed {
  industry: string;
  pillars: ContentPillar[];
  bestPostingDays: string[];
  bestPostingTimes: string[];
  platforms: Array<"linkedin" | "instagram" | "facebook" | "email">;
}

export const AU_INDUSTRY_SEEDS: IndustryCalendarSeed[] = [
  {
    industry: "Allied Health",
    pillars: [
      {
        name: "Patient Education",
        description: "Evidence-based health tips relevant to your specialty",
        exampleTopics: [
          "5 signs you should see a physio",
          "What to expect at your first appointment",
          "Home exercises for lower back pain",
        ],
        frequency: "weekly",
      },
      {
        name: "Behind the Scenes",
        description: "Humanise your practice",
        exampleTopics: [
          "A day in the life of our team",
          "Meet our new practitioner",
          "Our new equipment explained",
        ],
        frequency: "fortnightly",
      },
      {
        name: "Community",
        description: "Local area and referral partner content",
        exampleTopics: [
          "Spotlight on local sporting club",
          "Collaborating with our GP referral network",
          "Sponsoring the local fun run",
        ],
        frequency: "monthly",
      },
      {
        name: "Social Proof",
        description: "Testimonials and case studies (AHPRA-compliant)",
        exampleTopics: [
          "Client story: returning to sport after injury",
          "Google review highlight",
          "Before/after treatment journey (no specific claims)",
        ],
        frequency: "fortnightly",
      },
    ],
    bestPostingDays: ["Tuesday", "Wednesday", "Thursday"],
    bestPostingTimes: ["07:30", "12:00", "17:30"],
    platforms: ["instagram", "facebook", "email"],
  },
  {
    industry: "Trades & Construction",
    pillars: [
      {
        name: "Project Showcases",
        description: "Before/after photos of completed work",
        exampleTopics: [
          "Bathroom reno transformation",
          "Commercial fitout complete",
          "Heritage restoration project",
        ],
        frequency: "weekly",
      },
      {
        name: "Tips & Education",
        description: "Homeowner advice that builds trust",
        exampleTopics: [
          "How to spot dodgy tradie quotes",
          "When to call a licensed electrician",
          "Maintenance checklist for homeowners",
        ],
        frequency: "weekly",
      },
      {
        name: "Credentials & Trust",
        description: "Licences, insurance, associations",
        exampleTopics: [
          "What our Master Builders accreditation means",
          "Why we carry full public liability insurance",
          "How to check your tradie licence number",
        ],
        frequency: "monthly",
      },
    ],
    bestPostingDays: ["Monday", "Wednesday", "Friday"],
    bestPostingTimes: ["06:00", "11:30", "17:00"],
    platforms: ["facebook", "instagram", "linkedin"],
  },
  {
    industry: "Professional Services",
    pillars: [
      {
        name: "Thought Leadership",
        description: "Industry insights and commentary",
        exampleTopics: [
          "What the new ATO ruling means for SMBs",
          "5 legal mistakes startups make",
          "Preparing for EOFY: checklist",
        ],
        frequency: "weekly",
      },
      {
        name: "Client Success",
        description: "Anonymised case studies",
        exampleTopics: [
          "How we helped a client save in tax",
          "Structuring a business for sale",
          "Dispute resolution outcome",
        ],
        frequency: "fortnightly",
      },
      {
        name: "Process & Transparency",
        description: "How you work",
        exampleTopics: [
          "What happens in a discovery call",
          "How we price our services",
          "Our 3-step onboarding process",
        ],
        frequency: "monthly",
      },
    ],
    bestPostingDays: ["Tuesday", "Wednesday", "Thursday"],
    bestPostingTimes: ["08:00", "12:30", "16:00"],
    platforms: ["linkedin", "email"],
  },
];

export function getSeedForIndustry(
  industry: string
): IndustryCalendarSeed | undefined {
  const normalized = industry.toLowerCase();
  return AU_INDUSTRY_SEEDS.find((s) =>
    s.industry.toLowerCase().includes(normalized)
  );
}

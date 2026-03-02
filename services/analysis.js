import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Step 1: Infer product/brand themes from campaign names
 */
export async function inferThemes(campaignNames) {
  if (!campaignNames || campaignNames.length === 0) return [];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are analysing a Google Ads account structure.

Below is a list of campaign names. Group them into logical product or brand themes based on naming patterns.

Rules:
- Group by product, category, or brand — NOT by match type, network, geography, or funnel stage
- Examples of good themes: "Footwear", "Apparel", "Brand", "Competitor", "Seasonal"
- If all campaigns belong to one product, return a single theme called "All Campaigns"
- Assign every campaign to exactly one theme
- Return ONLY valid JSON, no explanation, no markdown

Campaigns:
${campaignNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return format:
{
  "themes": [
    {
      "name": "Theme Name",
      "inferred": true,
      "campaigns_included": ["Campaign Name 1", "Campaign Name 2"]
    }
  ]
}`
    }]
  });

  const text = response.content[0].text.trim();
  
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed.themes || [];
  } catch (e) {
    console.error('Theme inference parse error:', e, text);
    return [{ name: 'All Campaigns', inferred: true, campaigns_included: campaignNames }];
  }
}

/**
 * Aggregate campaign metrics into themes
 */
export function aggregateThemes(themes, campaigns) {
  return themes.map(theme => {
    const themeCampaigns = campaigns.filter(c =>
      theme.campaigns_included.includes(c.name)
    );

    const spend = sum(themeCampaigns, 'spend');
    const conversions = sum(themeCampaigns, 'conversions');
    const conversion_value = sum(themeCampaigns, 'conversion_value');
    const roas = spend > 0 ? +(conversion_value / spend).toFixed(2) : null;
    const cpa = conversions > 0 ? +(spend / conversions).toFixed(2) : null;

    // Previous period aggregates (from campaign spend_change_pct we back-calculate)
    // We store raw prev data on campaigns for this
    const prevSpend = themeCampaigns.reduce((acc, c) => {
      if (c.spend_change_pct !== null && c.prev_spend !== undefined) {
        return acc + (c.prev_spend || 0);
      }
      return acc;
    }, 0);

    const prevConversionValue = themeCampaigns.reduce((acc, c) => acc + (c.prev_conversion_value || 0), 0);
    const roas_previous = prevSpend > 0 ? +(prevConversionValue / prevSpend).toFixed(2) : null;
    const prevConversions = sum(themeCampaigns, 'prev_conversions');
    
    const spend_change_pct = prevSpend > 0
      ? +((spend - prevSpend) / prevSpend * 100).toFixed(1)
      : null;

    const conversion_change_pct = prevConversions > 0
      ? +((conversions - prevConversions) / prevConversions * 100).toFixed(1)
      : null;

    return {
      name: theme.name,
      inferred: theme.inferred,
      campaigns_included: theme.campaigns_included,
      spend: +spend.toFixed(2),
      conversions: +conversions.toFixed(0),
      conversion_value: +conversion_value.toFixed(2),
      roas,
      roas_previous,
      cpa,
      spend_change_pct,
      conversion_change_pct,
      status: deriveThemeStatus(roas, roas_previous, spend_change_pct)
    };
  });
}

function deriveThemeStatus(roas, roas_previous, spend_change_pct) {
  if (roas === null) return 'unknown';
  if (roas_previous === null) return 'new';
  const change = (roas - roas_previous) / roas_previous * 100;
  if (change < -20) return 'declining';
  if (change > 10) return 'growing';
  return 'stable';
}

/**
 * Main analysis prompt — generates the executive report JSON
 */
export async function generateReport(data) {
  const outputSchema = {
    report: {
      generated_at: 'ISO 8601 timestamp',
      period: 'Human readable period e.g. 1 Feb – 27 Feb 2025',
      comparison_period: 'Human readable comparison period',
      status: 'healthy | warning | critical',
      status_label: 'On Track | Needs Attention | Action Required',
      headline: 'One sentence capturing the single most important thing',
      summary: '2-3 sentence executive summary. Business outcomes only. No jargon.',
      signals: [
        {
          type: 'risk | positive | watch',
          title: 'Short title (under 8 words)',
          detail: '2-3 sentences. Business outcome focused. What it means, not what happened.',
          severity: 'critical | high | watch | null'
        }
      ],
      recommendation: {
        title: 'One clear action under 10 words',
        detail: '2-3 sentences. Who should do what, by when, and why it matters.'
      },
      themes: [
        {
          name: 'Theme name',
          status: 'healthy | stable | declining | growing | new | unknown',
          roas: 0.00,
          roas_change_pct: 0.0,
          spend: 0.00,
          spend_change_pct: 0.0,
          cpa: 0.00,
          narrative: 'One sentence. Directional and outcome-focused.'
        }
      ]
    }
  };

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a senior digital marketing analyst preparing a concise executive briefing for a C-suite audience.
Your reader is not a marketing expert — they care about business outcomes: revenue, efficiency, and risk.

Rules:
- Write at board level. No jargon. No mention of keywords, match types, quality scores, bid strategies, or ad formats.
- Every insight must be tied to a business outcome — revenue, cost efficiency, or financial risk.
- The headline must be ONE sentence that captures the single most important thing happening right now.
- Signals: 2–4 maximum. Prioritise the anomalies provided. Do not invent signals not supported by the data.
- The recommendation must be SINGULAR and actionable. One thing. Clearly state who owns it.
- Status must be one of: healthy, warning, critical
- If conversion_value is zero across all campaigns and spend is non-zero, make conversion tracking the primary concern regardless of anything else.
- Do not speculate beyond what the data shows. If data is insufficient, say so plainly.
- Theme narratives: one sentence each, directional and outcome-focused.
- Return ONLY valid JSON. No markdown, no explanation, nothing outside the JSON.

Performance Data:
${JSON.stringify(data, null, 2)}

Return JSON matching this exact schema:
${JSON.stringify(outputSchema, null, 2)}`
    }]
  });

  const text = response.content[0].text.trim();

  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Report parse error:', e, text);
    throw new Error('Failed to parse analysis output');
  }
}

function sum(arr, key) {
  return arr.reduce((acc, item) => acc + (item[key] || 0), 0);
}

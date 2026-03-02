/**
 * Google Ads API Service
 * Uses the REST API directly to avoid SDK complexities with one-time tokens
 */

const ADS_API_VERSION = 'v17';
const ADS_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

async function gaqlQuery(customerId, query, accessToken, developerToken) {
  const cleanId = customerId.replace(/-/g, '');
  const url = `${ADS_BASE}/customers/${cleanId}/googleAds:search`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Ads API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.results || [];
}

async function getAccessibleCustomers(accessToken, developerToken) {
  const url = `${ADS_BASE}/customers:listAccessibleCustomers`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken
    }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list customers: ${err}`);
  }

  const data = await res.json();
  // Returns resource names like "customers/1234567890"
  return (data.resourceNames || []).map(r => r.replace('customers/', ''));
}

function micros(value) {
  return (value || 0) / 1_000_000;
}

function getPeriodDates(periodType = 'mtd') {
  const now = new Date();
  
  if (periodType === 'mtd') {
    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentEnd = now;
    
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    return {
      current: { start: fmt(currentStart), end: fmt(currentEnd) },
      previous: { start: fmt(prevStart), end: fmt(prevEnd) },
      daysElapsed: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    };
  }

  if (periodType === 'last7') {
    const currentEnd = now;
    const currentStart = new Date(now - 7 * 86400000);
    const previousEnd = new Date(currentStart - 86400000);
    const previousStart = new Date(previousEnd - 6 * 86400000);
    return {
      current: { start: fmt(currentStart), end: fmt(currentEnd) },
      previous: { start: fmt(previousStart), end: fmt(previousEnd) },
      daysElapsed: 7,
      daysInMonth: 7
    };
  }

  if (periodType === 'last30') {
    const currentEnd = now;
    const currentStart = new Date(now - 30 * 86400000);
    const previousEnd = new Date(currentStart - 86400000);
    const previousStart = new Date(previousEnd - 29 * 86400000);
    return {
      current: { start: fmt(currentStart), end: fmt(currentEnd) },
      previous: { start: fmt(previousStart), end: fmt(previousEnd) },
      daysElapsed: 30,
      daysInMonth: 30
    };
  }
}

function fmt(date) {
  return date.toISOString().split('T')[0];
}

export async function fetchAccountData(accessToken, customerId, periodType = 'mtd') {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const periods = getPeriodDates(periodType);

  // Query 1: Campaign list
  const campaignRows = await gaqlQuery(customerId, `
    SELECT 
      campaign.id,
      campaign.name,
      campaign.status,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `, accessToken, devToken);

  // Query 2: Current period metrics
  const currentRows = await gaqlQuery(customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr
    FROM campaign
    WHERE segments.date BETWEEN '${periods.current.start}' AND '${periods.current.end}'
    AND campaign.status != 'REMOVED'
  `, accessToken, devToken);

  // Query 3: Previous period metrics
  const previousRows = await gaqlQuery(customerId, `
    SELECT
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr
    FROM campaign
    WHERE segments.date BETWEEN '${periods.previous.start}' AND '${periods.previous.end}'
    AND campaign.status != 'REMOVED'
  `, accessToken, devToken);

  // Query 4: Account info
  const accountRows = await gaqlQuery(customerId, `
    SELECT
      customer.descriptive_name,
      customer.currency_code
    FROM customer
    LIMIT 1
  `, accessToken, devToken);

  // --- Aggregate ---
  const accountInfo = accountRows[0]?.customer || {};

  // Build campaign map
  const currentMap = {};
  for (const row of currentRows) {
    const id = row.campaign.id;
    currentMap[id] = {
      name: row.campaign.name,
      status: row.campaign.status,
      budget: micros(row.campaignBudget?.amountMicros),
      spend: micros(row.metrics.costMicros),
      impressions: row.metrics.impressions || 0,
      clicks: row.metrics.clicks || 0,
      conversions: row.metrics.conversions || 0,
      conversion_value: row.metrics.conversionsValue || 0,
      ctr: row.metrics.ctr || 0
    };
  }

  const previousMap = {};
  for (const row of previousRows) {
    const id = row.campaign.id;
    previousMap[id] = {
      spend: micros(row.metrics.costMicros),
      impressions: row.metrics.impressions || 0,
      clicks: row.metrics.clicks || 0,
      conversions: row.metrics.conversions || 0,
      conversion_value: row.metrics.conversionsValue || 0
    };
  }

  // Account-level aggregates
  const current = aggregateMetrics(Object.values(currentMap));
  const previous = aggregateMetrics(Object.values(previousMap));

  // Total monthly budget
  const monthlyBudget = Object.values(currentMap).reduce((sum, c) => sum + (c.budget || 0), 0);

  const campaigns = Object.values(currentMap).map(c => {
    const prev = previousMap[campaignRows.find(r => r.campaign.name === c.name)?.campaign?.id] || {};
    const spendChange = prev.spend ? pct(c.spend, prev.spend) : null;
    return {
      name: c.name,
      status: c.status,
      spend: c.spend,
      conversions: c.conversions,
      conversion_value: c.conversion_value,
      roas: c.conversion_value && c.spend ? +(c.conversion_value / c.spend).toFixed(2) : null,
      cpa: c.conversions && c.spend ? +(c.spend / c.conversions).toFixed(2) : null,
      budget_utilisation: c.budget ? +(c.spend / c.budget).toFixed(2) : null,
      spend_change_pct: spendChange
    };
  });

  return {
    account: {
      name: accountInfo.descriptiveName || 'Unknown Account',
      currency: accountInfo.currencyCode || 'USD',
      customer_id: customerId,
      reporting_period: periods.current,
      comparison_period: periods.previous
    },
    budget: {
      monthly_budget: monthlyBudget,
      spent_to_date: current.spend,
      days_elapsed: periods.daysElapsed,
      days_in_month: periods.daysInMonth,
      pacing_percentage: monthlyBudget
        ? +((current.spend / monthlyBudget) / (periods.daysElapsed / periods.daysInMonth) * 100).toFixed(1)
        : null
    },
    performance: {
      current: formatMetrics(current),
 * Anomaly Detection Service
 * Pure arithmetic — Claude is not involved here.
 * Detects signals at account level and theme level.
 */

export function detectAnomalies(data) {
  const anomalies = [];
  const { budget, performance, campaigns, themes } = data;

  // --- Budget & Pacing ---
  if (budget.pacing_percentage !== null) {
    if (budget.pacing_percentage > 110) {
      anomalies.push({
        type: 'budget_overpacing',
        level: 'account',
        severity: 'critical',
        detail: `Account is pacing at ${budget.pacing_percentage}% — on track to overspend the monthly budget`,
        metric: budget.pacing_percentage
      });
    } else if (budget.pacing_percentage < 80) {
      anomalies.push({
        type: 'budget_underpacing',
        level: 'account',
        severity: budget.pacing_percentage < 60 ? 'high' : 'watch',
        detail: `Account pacing at ${budget.pacing_percentage}% — likely to underspend and miss delivery targets`,
        metric: budget.pacing_percentage
      });
    }
  }

  // --- Account-level performance ---
  const cur = performance.current;
  const prev = performance.previous;

  // ROAS drop
  if (cur.roas !== null && prev.roas !== null && prev.roas > 0) {
    const roasChange = pct(cur.roas, prev.roas);
    if (roasChange < -20) {
      anomalies.push({
        type: 'roas_drop',
        level: 'account',
        severity: roasChange < -35 ? 'critical' : 'high',
        detail: `Account ROAS down ${Math.abs(roasChange).toFixed(1)}% vs prior period (${prev.roas} → ${cur.roas})`,
        metric: roasChange
      });
    }
  }

  // Spend spike without conversion lift
  if (prev.spend > 0) {
    const spendChange = pct(cur.spend, prev.spend);
    const convChange = prev.conversions > 0 ? pct(cur.conversions, prev.conversions) : null;
    if (spendChange > 15 && (convChange === null || convChange < 5)) {
      anomalies.push({
        type: 'spend_spike_no_conversion_lift',
        level: 'account',
        severity: 'high',
        detail: `Spend up ${spendChange.toFixed(1)}% but conversions ${convChange !== null ? (convChange > 0 ? `up only ${convChange.toFixed(1)}%` : `down ${Math.abs(convChange).toFixed(1)}%`) : 'not tracked'}`,
        metric: { spendChange, convChange }
      });
    }
  }

  // CPA spike
  if (cur.cpa !== null && prev.cpa !== null && prev.cpa > 0) {
    const cpaChange = pct(cur.cpa, prev.cpa);
    if (cpaChange > 25) {
      anomalies.push({
        type: 'cpa_spike',
        level: 'account',
        severity: cpaChange > 50 ? 'critical' : 'high',
        detail: `Cost per acquisition up ${cpaChange.toFixed(1)}% vs prior period (${formatCurrency(prev.cpa)} → ${formatCurrency(cur.cpa)})`,
        metric: cpaChange
      });
    }
  }

  // Conversion drop
  if (prev.conversions > 0) {
    const convDrop = pct(cur.conversions, prev.conversions);
    if (convDrop < -30) {
      anomalies.push({
        type: 'conversion_drop',
        level: 'account',
        severity: convDrop < -50 ? 'critical' : 'high',
        detail: `Conversions down ${Math.abs(convDrop).toFixed(1)}% vs prior period`,
        metric: convDrop
      });
    }
  }

  // Conversion tracking gap
  if (cur.conversion_value === 0 && cur.spend > 0) {
    anomalies.push({
      type: 'conversion_tracking_gap',
      level: 'account',
      severity: 'critical',
      detail: 'No conversion value recorded this period despite active spend — conversion tracking may be broken',
      metric: null
    });
  }

  // --- Campaign-level ---
  for (const campaign of campaigns) {
    // Over-budget campaigns
    if (campaign.budget_utilisation !== null && campaign.budget_utilisation > 1.1) {
      anomalies.push({
        type: 'campaign_over_budget',
        level: 'campaign',
        campaign: campaign.name,
        severity: 'high',
        detail: `"${campaign.name}" has exceeded its budget (${(campaign.budget_utilisation * 100).toFixed(0)}% utilised)`,
        metric: campaign.budget_utilisation
      });
    }

    // Active but zero spend
    if (campaign.status === 'ENABLED' && campaign.spend === 0) {
      anomalies.push({
        type: 'campaign_no_spend',
        level: 'campaign',
        campaign: campaign.name,
        severity: 'watch',
        detail: `"${campaign.name}" is enabled but has no spend this period`,
        metric: null
      });
    }
  }

  // --- Theme-level ---
  if (themes) {
    for (const theme of themes) {
      if (theme.roas !== null && theme.roas_previous !== null && theme.roas_previous > 0) {
        const roasChange = pct(theme.roas, theme.roas_previous);
        if (roasChange < -20) {
          anomalies.push({
            type: 'theme_roas_drop',
            level: 'theme',
            theme: theme.name,
            severity: roasChange < -35 ? 'critical' : 'high',
            detail: `"${theme.name}" ROAS down ${Math.abs(roasChange).toFixed(1)}% vs prior period (${theme.roas_previous?.toFixed(2)} → ${theme.roas?.toFixed(2)})`,
            metric: roasChange
          });
        }
      }

      if (theme.spend_change_pct !== null && theme.spend_change_pct > 20 && (theme.conversion_change_pct === null || theme.conversion_change_pct < 5)) {
        anomalies.push({
          type: 'theme_spend_spike',
          level: 'theme',
          theme: theme.name,
          severity: 'high',
          detail: `"${theme.name}" spend up ${theme.spend_change_pct.toFixed(1)}% with no corresponding conversion lift`,
          metric: theme.spend_change_pct
        });
      }
    }
  }

  // Sort by severity
  const order = { critical: 0, high: 1, watch: 2 };
  return anomalies.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

function pct(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous * 100;
}

function formatCurrency(val) {
  return val ? `$${val.toFixed(2)}` : 'N/A';
}

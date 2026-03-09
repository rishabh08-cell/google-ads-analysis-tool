/**
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

          if (theme.spend_change_pct !== null && theme.spend_change_pct > 20
                      && (theme.conversion_change_pct === null || theme.conversion_change_pct < 5)) {
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

/**
 * Google Ads API Service
 * Uses the REST API directly to avoid SDK complexities with one-time tokens
 */

const ADS_API_VERSION = 'v23';
const ADS_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

async function gaqlQuery(customerId, query, accessToken, developerToken, loginCustomerId) {
        const cleanId = customerId.replace(/-/g, '');
        const url = `${ADS_BASE}/customers/${cleanId}/googleAds:search`;

    const headers = {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': developerToken,
                'Content-Type': 'application/json'
    };

    // If loginCustomerId is provided, add it as a header for MCC access
    if (loginCustomerId) {
                headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
    }

    const res = await fetch(url, {
                method: 'POST',
                headers,
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
    const directIds = (data.resourceNames || []).map(r => r.replace('customers/', ''));

    console.log('[accounts] Accessible customer IDs:', directIds);

    // Now query each accessible customer for child accounts (handles MCC hierarchies)
    const allAccounts = new Map();

    for (const id of directIds) {
                try {
                                // Try to get account info including manager status
                    const infoRows = await gaqlQuery(id, `
                                    SELECT
                                                        customer.id,
                                                                            customer.descriptive_name,
                                                                                                customer.manager,
                                                                                                                    customer.test_account
                                                                                                                                    FROM customer
                                                                                                                                                    LIMIT 1
                                                                                                                                                                `, accessToken, developerToken);

                    const info = infoRows[0]?.customer || {};
                                console.log(`[accounts] Account ${id}: name="${info.descriptiveName}", manager=${info.manager}, test=${info.testAccount}`);

                    allAccounts.set(id, {
                                        id,
                                        name: info.descriptiveName || `Account ${id}`,
                                        isManager: info.manager || false,
                                        isTestAccount: info.testAccount || false
                    });

                    // If this is a manager account, also fetch its child accounts
                    if (info.manager) {
                                        console.log(`[accounts] Querying child accounts for MCC ${id}...`);
                                        try {
                                                                const childRows = await gaqlQuery(id, `
                                                                                        SELECT
                                                                                                                    customer_client.client_customer,
                                                                                                                                                customer_client.descriptive_name,
                                                                                                                                                                            customer_client.manager,
                                                                                                                                                                                                        customer_client.test_account,
                                                                                                                                                                                                                                    customer_client.level
                                                                                                                                                                                                                                                            FROM customer_client
                                                                                                                                                                                                                                                                                    WHERE customer_client.level <= 1
                                                                                                                                                                                                                                                                                                        `, accessToken, developerToken, id);

                                            console.log(`[accounts] MCC ${id} has ${childRows.length} child entries`);

                                            for (const row of childRows) {
                                                                        const cc = row.customerClient;
                                                                        if (!cc) {
                                                                                                        console.log(`[accounts] Unexpected row format:`, JSON.stringify(row));
                                                                                                        continue;
                                                                            }
                                                                        const childId = cc.clientCustomer?.replace('customers/', '') || '';
                                                                        console.log(`[accounts] Child: id=${childId}, name="${cc.descriptiveName}", level=${cc.level}, manager=${cc.manager}`);
                                                                        if (childId && childId !== id) {
                                                                                                        allAccounts.set(childId, {
                                                                                                                                            id: childId,
                                                                                                                                            name: cc.descriptiveName || `Account ${childId}`,
                                                                                                                                            isManager: cc.manager || false,
                                                                                                                                            isTestAccount: cc.testAccount || false
                                                                                                            });
                                                                            }
                                            }
                                        } catch (childErr) {
                                                                console.warn(`[accounts] Could not fetch child accounts for MCC ${id}:`, childErr.message);
                                        }
                    }
                } catch (infoErr) {
                                // If we can't get info, still add it with basic details
                    allAccounts.set(id, {
                                        id,
                                        name: `Account ${id}`,
                                        isManager: false,
                                        isTestAccount: false
                    });
                                console.warn(`[accounts] Could not get info for account ${id}:`, infoErr.message);
                }
    }

    const result = Array.from(allAccounts.values());
        console.log(`[accounts] Total accounts found: ${result.length}`, result.map(a => `${a.id} (${a.name})`));
        return result;
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
                                daysElapsed: 7, daysInMonth: 7
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
                                daysElapsed: 30, daysInMonth: 30
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
                                pacing_percentage: monthlyBudget ? +((current.spend / monthlyBudget) / (periods.daysElapsed / periods.daysInMonth) * 100).toFixed(1) : null
                },
                performance: {
                                current: formatMetrics(current),
                                previous: formatMetrics(previous)
                },
                campaigns,
                campaign_names: campaigns.map(c => c.name)
    };
}

function aggregateMetrics(rows) {
        return rows.reduce((acc, r) => ({
                    spend: acc.spend + (r.spend || 0),
                    impressions: acc.impressions + (r.impressions || 0),
                    clicks: acc.clicks + (r.clicks || 0),
                    conversions: acc.conversions + (r.conversions || 0),
                    conversion_value: acc.conversion_value + (r.conversion_value || 0)
        }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 });
}

function formatMetrics(m) {
        return {
                    spend: +m.spend.toFixed(2),
                    impressions: m.impressions,
                    clicks: m.clicks,
                    conversions: +m.conversions.toFixed(0),
                    conversion_value: +m.conversion_value.toFixed(2),
                    roas: m.spend ? +(m.conversion_value / m.spend).toFixed(2) : null,
                    cpa: m.conversions ? +(m.spend / m.conversions).toFixed(2) : null,
                    ctr: m.impressions ? +(m.clicks / m.impressions).toFixed(4) : null
        };
}

function pct(current, previous) {
        if (!previous) return null;
        return +((current - previous) / previous * 100).toFixed(1);
}

export { getAccessibleCustomers, getPeriodDates };

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../utils/db.js';
import { fetchAccountData, getAccessibleCustomers } from '../services/googleAds.js';
import { inferThemes, aggregateThemes, generateReport } from '../services/analysis.js';
import { detectAnomalies } from '../services/anomalyDetection.js';

const router = express.Router();

/**
 * GET /api/accounts
 * List accessible Google Ads accounts for the authenticated user
 */
router.get('/accounts', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const accessToken = authHeader.replace('Bearer ', '');

  try {
    const customerIds = await getAccessibleCustomers(accessToken, process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
    res.json({ accounts: customerIds.map(id => ({ id, name: `Account ${id}` })) });
  } catch (err) {
    console.error('Accounts fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reports/generate
 * Full pipeline: fetch → infer themes → detect anomalies → analyse → store → return report URL
 */
router.post('/generate', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const accessToken = authHeader.replace('Bearer ', '');
  const { customer_id, period_type = 'mtd' } = req.body;

  if (!customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }

  try {
    // Step 1: Fetch raw data from Google Ads
    console.log(`[${customer_id}] Fetching account data...`);
    const rawData = await fetchAccountData(accessToken, customer_id, period_type);

    // Step 2: Infer themes from campaign names
    console.log(`[${customer_id}] Inferring themes for ${rawData.campaign_names.length} campaigns...`);
    const inferredThemes = await inferThemes(rawData.campaign_names);

    // Step 3: Aggregate metrics by theme
    const themes = aggregateThemes(inferredThemes, rawData.campaigns);

    // Step 4: Detect anomalies
    const dataWithThemes = { ...rawData, themes };
    const anomalies = detectAnomalies(dataWithThemes);

    // Step 5: Build full data payload for Claude
    const analysisInput = {
      account: rawData.account,
      budget: rawData.budget,
      performance: rawData.performance,
      themes,
      campaigns: rawData.campaigns,
      anomalies
    };

    // Step 6: Generate executive report via Claude
    console.log(`[${customer_id}] Generating executive report...`);
    const reportOutput = await generateReport(analysisInput);

    // Step 7: Store report output only (no raw ad data)
    const reportId = uuidv4();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days

    const fullReport = {
      ...reportOutput,
      meta: {
        report_id: reportId,
        account_name: rawData.account.name,
        currency: rawData.account.currency,
        customer_id: rawData.account.customer_id,
        period_type,
        created_at: now
      }
    };

    const db = getDb();
    db.prepare(`
      INSERT INTO reports (id, created_at, expires_at, account_name, report_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(reportId, now, expiresAt, rawData.account.name, JSON.stringify(fullReport));

    console.log(`[${customer_id}] Report generated: ${reportId}`);

    // Step 8: Return report URL — token is never stored, used only in memory
    res.json({
      report_id: reportId,
      report_url: `${process.env.BASE_URL}/report/${reportId}`,
      account_name: rawData.account.name
    });

  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/:id
 * Fetch a report by ID (public — anyone with the link)
 */
router.get('/:id', (req, res) => {
  const db = getDb();
  const report = db.prepare(`
    SELECT * FROM reports 
    WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id);

  if (!report) {
    return res.status(404).json({ error: 'Report not found or has been deleted' });
  }

  if (report.expires_at && new Date(report.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This report has expired' });
  }

  res.json(JSON.parse(report.report_json));
});

/**
 * DELETE /api/reports/:id
 * Soft delete a report — link returns 404 after this
 */
router.delete('/:id', (req, res) => {
  const db = getDb();
  const report = db.prepare(`
    SELECT id FROM reports WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id);

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  db.prepare(`
    UPDATE reports SET deleted_at = ? WHERE id = ?
  `).run(new Date().toISOString(), req.params.id);

  res.json({ success: true, message: 'Report deleted successfully' });
});

export default router;

import React from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

export default function LandingPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <span style={styles.logo}>Ads Intel</span>
        <span style={styles.tagline}>by Pepper</span>
      </header>

      {/* Hero */}
      <main style={styles.main}>
        <div style={styles.hero} className="fade-up">
          <div style={styles.eyebrow}>Executive Intelligence</div>
          <h1 style={styles.headline}>
            Your Google Ads,<br />
            <em>translated for the boardroom.</em>
          </h1>
          <p style={styles.subheadline}>
            Connect your account once. We fetch your data, analyse what matters, 
            and generate a shareable executive report — no credentials stored, ever.
          </p>

          {error && (
            <div style={styles.errorBanner}>
              Authentication failed. Please try again.
            </div>
          )}

          <a href={`${BACKEND_URL}/auth/connect`} style={styles.ctaButton}>
            <GoogleIcon />
            Connect Google Ads
          </a>

          <p style={styles.privacyNote}>
            Read-only access · One-time fetch · No data stored · Delete anytime
          </p>
        </div>

        {/* What you get */}
        <div style={styles.featuresGrid} className="fade-up">
          {features.map((f, i) => (
            <div key={i} style={styles.featureCard}>
              <div style={styles.featureIcon}>{f.icon}</div>
              <div style={styles.featureTitle}>{f.title}</div>
              <div style={styles.featureDesc}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Report preview strip */}
        <div style={styles.previewStrip}>
          <div style={styles.previewLabel}>Sample output</div>
          <div style={styles.previewCards}>
            {previewItems.map((item, i) => (
              <div key={i} style={{
                ...styles.previewCard,
                borderLeft: `3px solid ${item.color}`
              }}>
                <div style={{ ...styles.previewStatus, color: item.color }}>{item.status}</div>
                <div style={styles.previewText}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer style={styles.footer}>
        <span>© {new Date().getFullYear()} Pepper.inc</span>
        <span style={{ color: 'var(--ink-faint)' }}>·</span>
        <span>Reports expire after 90 days</span>
      </footer>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
      <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
      <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/>
    </svg>
  );
}

const features = [
  {
    icon: '◎',
    title: 'Executive Summary',
    desc: 'Traffic light status, headline insight, and the one thing that needs your attention.'
  },
  {
    icon: '◈',
    title: 'Product-Level ROAS',
    desc: 'AI groups your campaigns by product or brand theme. See performance where it actually matters.'
  },
  {
    icon: '◇',
    title: 'Anomaly Detection',
    desc: 'Spend spikes, conversion drops, and budget pacing issues surfaced automatically.'
  },
  {
    icon: '◻',
    title: 'Shareable Link',
    desc: 'One clean URL. Forward to your CFO or board without giving anyone platform access.'
  }
];

const previewItems = [
  {
    status: '● Critical',
    color: '#c84b2f',
    text: 'Apparel ROAS down 24% — spend running at the same rate as last month with significantly less return'
  },
  {
    status: '● Watch',
    color: '#c07a00',
    text: 'Account pacing at 112% — on track to overspend monthly budget by £4,200 at current rate'
  },
  {
    status: '● Healthy',
    color: '#2d6a4f',
    text: 'Footwear efficiency improving — ROAS up 12% month-on-month with stable spend levels'
  }
];

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '920px',
    margin: '0 auto',
    padding: '0 24px'
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '32px 0 0'
  },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.25rem',
    color: 'var(--ink)'
  },
  tagline: {
    fontSize: '0.8rem',
    color: 'var(--ink-muted)',
    fontWeight: 300,
    letterSpacing: '0.05em'
  },
  main: {
    flex: 1,
    paddingTop: '80px',
    paddingBottom: '80px'
  },
  hero: {
    maxWidth: '620px',
    marginBottom: '72px'
  },
  eyebrow: {
    fontSize: '0.72rem',
    fontWeight: 500,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--accent)',
    marginBottom: '20px'
  },
  headline: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(2.4rem, 5vw, 3.6rem)',
    lineHeight: 1.15,
    color: 'var(--ink)',
    marginBottom: '24px',
    fontWeight: 400
  },
  subheadline: {
    fontSize: '1.05rem',
    color: 'var(--ink-muted)',
    fontWeight: 300,
    lineHeight: 1.7,
    marginBottom: '40px',
    maxWidth: '520px'
  },
  errorBanner: {
    background: 'var(--critical-light)',
    border: '1px solid var(--critical)',
    color: 'var(--critical)',
    padding: '12px 16px',
    borderRadius: '6px',
    fontSize: '0.875rem',
    marginBottom: '24px'
  },
  ctaButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    background: 'var(--ink)',
    color: 'var(--paper)',
    padding: '14px 28px',
    borderRadius: '6px',
    textDecoration: 'none',
    fontSize: '0.95rem',
    fontWeight: 500,
    letterSpacing: '0.01em',
    transition: 'background 0.2s',
    marginBottom: '16px'
  },
  privacyNote: {
    fontSize: '0.78rem',
    color: 'var(--ink-faint)',
    marginTop: '12px',
    letterSpacing: '0.02em'
  },
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1px',
    background: 'var(--border)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '56px'
  },
  featureCard: {
    background: 'var(--paper)',
    padding: '28px 24px'
  },
  featureIcon: {
    fontSize: '1.2rem',
    color: 'var(--ink-muted)',
    marginBottom: '12px'
  },
  featureTitle: {
    fontWeight: 500,
    fontSize: '0.9rem',
    marginBottom: '8px',
    color: 'var(--ink)'
  },
  featureDesc: {
    fontSize: '0.82rem',
    color: 'var(--ink-muted)',
    lineHeight: 1.6
  },
  previewStrip: {
    borderTop: '1px solid var(--border)',
    paddingTop: '40px'
  },
  previewLabel: {
    fontSize: '0.72rem',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    marginBottom: '20px'
  },
  previewCards: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  previewCard: {
    padding: '16px 20px',
    background: 'white',
    borderRadius: '4px'
  },
  previewStatus: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: '6px'
  },
  previewText: {
    fontSize: '0.875rem',
    color: 'var(--ink-muted)',
    lineHeight: 1.5
  },
  footer: {
    display: 'flex',
    gap: '12px',
    padding: '24px 0',
    borderTop: '1px solid var(--border)',
    fontSize: '0.78rem',
    color: 'var(--ink-muted)'
  }
};

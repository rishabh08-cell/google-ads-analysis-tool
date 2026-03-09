import express from 'express';

const router = express.Router();

const SCOPES = [
    'https://www.googleapis.com/auth/adwords'
  ];

function getBaseUrl(req) {
    return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Step 1: Redirect user to Google OAuth
router.get('/connect', (req, res) => {
    const params = new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
          response_type: 'code',
          scope: SCOPES.join(' '),
          access_type: 'online',
          prompt: 'consent select_account',
          state: 'oneshot'
    });

             res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Handle callback - exchange code for access token
router.get('/callback', async (req, res) => {
    const { code, error } = req.query;
    const baseUrl = getBaseUrl(req);

             if (error || !code) {
                   return res.redirect(`${baseUrl}/?error=auth_failed`);
             }

             try {
                   const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                           body: new URLSearchParams({
                                     code,
                                     client_id: process.env.GOOGLE_CLIENT_ID,
                                     client_secret: process.env.GOOGLE_CLIENT_SECRET,
                                     redirect_uri: process.env.GOOGLE_REDIRECT_URI,
                                     grant_type: 'authorization_code'
                           })
                   });

      const tokenData = await tokenRes.json();

      if (tokenData.error) {
              console.error('Token exchange error:', tokenData.error);
              return res.redirect(`${baseUrl}/?error=token_failed`);
      }

      const params = new URLSearchParams({
              access_token: tokenData.access_token,
              token_type: tokenData.token_type || 'Bearer'
      });

      res.redirect(`${baseUrl}/generate?${params}`);
             } catch (err) {
                   console.error('OAuth callback error:', err);
                   res.redirect(`${baseUrl}/?error=server_error`);
             }
});

export default router;

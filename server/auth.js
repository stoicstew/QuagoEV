import { Router } from 'express';
import crypto from 'crypto';

export const authRouter = Router();

const TESLA_AUTH_URL = 'https://auth.tesla.com/oauth2/v3';
const TESLA_TOKEN_URL = 'https://auth.tesla.com/oauth2/v3/token';

// Store PKCE verifiers by session
const pkceStore = new Map();

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Step 1: Generate auth URL for Tesla OAuth
authRouter.get('/login', (_req, res) => {
  const state = base64url(crypto.randomBytes(16));
  const { verifier, challenge } = generatePKCE();

  pkceStore.set(state, verifier);

  // Clean up old entries after 10 minutes
  setTimeout(() => pkceStore.delete(state), 600_000);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TESLA_CLIENT_ID,
    redirect_uri: process.env.TESLA_REDIRECT_URI,
    scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds energy_device_data energy_cmds offline_access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  res.json({ url: `${TESLA_AUTH_URL}/authorize?${params}` });
});

// Step 2: Exchange authorization code for tokens
authRouter.post('/callback', async (req, res) => {
  const { code, state } = req.body;

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  const verifier = pkceStore.get(state);
  if (!verifier) {
    return res.status(400).json({ error: 'Invalid or expired state' });
  }
  pkceStore.delete(state);

  try {
    const tokenRes = await fetch(TESLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.TESLA_CLIENT_ID,
        client_secret: process.env.TESLA_CLIENT_SECRET,
        code,
        redirect_uri: process.env.TESLA_REDIRECT_URI,
        code_verifier: verifier,
        audience: process.env.TESLA_FLEET_API || 'https://fleet-api.prd.na.vn.cloud.tesla.com',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', err);
      return res.status(tokenRes.status).json({ error: 'Token exchange failed', details: err });
    }

    const tokens = await tokenRes.json();
    const sessionId = base64url(crypto.randomBytes(24));

    req.tokenStore.set(sessionId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });

    res.cookie('quagoev_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Refresh token
authRouter.post('/refresh', async (req, res) => {
  const sessionId = req.cookies.quagoev_session;
  const session = sessionId && req.tokenStore.get(sessionId);

  if (!session?.refresh_token) {
    return res.status(401).json({ error: 'No session' });
  }

  try {
    const tokenRes = await fetch(TESLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.TESLA_CLIENT_ID,
        client_secret: process.env.TESLA_CLIENT_SECRET,
        refresh_token: session.refresh_token,
      }),
    });

    if (!tokenRes.ok) {
      req.tokenStore.delete(sessionId);
      return res.status(401).json({ error: 'Refresh failed' });
    }

    const tokens = await tokenRes.json();
    req.tokenStore.set(sessionId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || session.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// Check auth status
authRouter.get('/status', (req, res) => {
  const sessionId = req.cookies.quagoev_session;
  const session = sessionId && req.tokenStore.get(sessionId);
  res.json({ authenticated: !!session?.access_token });
});

// Logout
authRouter.post('/logout', (req, res) => {
  const sessionId = req.cookies.quagoev_session;
  if (sessionId) {
    req.tokenStore.delete(sessionId);
  }
  res.clearCookie('quagoev_session');
  res.json({ success: true });
});

import { Router } from 'express';

export const apiRouter = Router();

const FLEET_API = process.env.TESLA_FLEET_API || 'https://fleet-api.prd.na.vn.cloud.tesla.com';

// Register partner account on first authenticated request
let partnerRegistered = false;

async function ensurePartnerRegistered(token) {
  if (partnerRegistered) return;
  try {
    console.log('Registering partner account with Tesla Fleet API...');
    const res = await fetch(`${FLEET_API}/api/1/partner_accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'localhost' }),
    });
    const data = await res.json();
    console.log('Partner registration response:', JSON.stringify(data));
    if (res.ok || data?.response?.account_id) {
      partnerRegistered = true;
    }
  } catch (err) {
    console.error('Partner registration failed:', err);
  }
}

// Auth middleware
function requireAuth(req, res, next) {
  const sessionId = req.cookies.quagoev_session;
  const session = sessionId && req.tokenStore.get(sessionId);

  if (!session?.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Auto-refresh if token expires within 5 minutes
  if (session.expires_at - Date.now() < 300_000) {
    // Let the request proceed but trigger a background refresh
    refreshToken(req.tokenStore, sessionId, session).catch(console.error);
  }

  req.teslaToken = session.access_token;
  next();
}

async function refreshToken(tokenStore, sessionId, session) {
  try {
    const res = await fetch('https://auth.tesla.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.TESLA_CLIENT_ID,
        client_secret: process.env.TESLA_CLIENT_SECRET,
        refresh_token: session.refresh_token,
      }),
    });
    if (res.ok) {
      const tokens = await res.json();
      tokenStore.set(sessionId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || session.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
      });
    }
  } catch (err) {
    console.error('Background refresh failed:', err);
  }
}

async function teslaFetch(token, path, options = {}) {
  const res = await fetch(`${FLEET_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Tesla API error [${res.status}] ${path}:`, JSON.stringify(data));
  }
  return data;
}

// List vehicles
apiRouter.get('/vehicles', requireAuth, async (req, res) => {
  try {
    await ensurePartnerRegistered(req.teslaToken);
    const data = await teslaFetch(req.teslaToken, '/api/1/vehicles');
    res.json(data);
  } catch (err) {
    console.error('Vehicles error:', err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// Get full vehicle data
apiRouter.get('/vehicles/:id/data', requireAuth, async (req, res) => {
  try {
    const endpoints = [
      'charge_state',
      'climate_state',
      'drive_state',
      'gui_settings',
      'vehicle_config',
      'vehicle_state',
      'location_data',
    ].join(';');
    const data = await teslaFetch(
      req.teslaToken,
      `/api/1/vehicles/${req.params.id}/vehicle_data?endpoints=${endpoints}`
    );
    res.json(data);
  } catch (err) {
    console.error('Vehicle data error:', err);
    res.status(500).json({ error: 'Failed to fetch vehicle data' });
  }
});

// Get charge state
apiRouter.get('/vehicles/:id/charge', requireAuth, async (req, res) => {
  try {
    const data = await teslaFetch(
      req.teslaToken,
      `/api/1/vehicles/${req.params.id}/data_request/charge_state`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch charge state' });
  }
});

// Get drive state
apiRouter.get('/vehicles/:id/drive', requireAuth, async (req, res) => {
  try {
    const data = await teslaFetch(
      req.teslaToken,
      `/api/1/vehicles/${req.params.id}/data_request/drive_state`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch drive state' });
  }
});

// Send command to vehicle
apiRouter.post('/vehicles/:id/command/:command', requireAuth, async (req, res) => {
  try {
    const data = await teslaFetch(
      req.teslaToken,
      `/api/1/vehicles/${req.params.id}/command/${req.params.command}`,
      { method: 'POST', body: JSON.stringify(req.body) }
    );
    res.json(data);
  } catch (err) {
    console.error('Command error:', err);
    res.status(500).json({ error: 'Command failed' });
  }
});

// Wake up vehicle
apiRouter.post('/vehicles/:id/wake', requireAuth, async (req, res) => {
  try {
    const data = await teslaFetch(
      req.teslaToken,
      `/api/1/vehicles/${req.params.id}/wake_up`,
      { method: 'POST' }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Wake up failed' });
  }
});

// Charging history (for cost analytics)
apiRouter.get('/vehicles/:id/charging-history', requireAuth, async (req, res) => {
  try {
    const data = await teslaFetch(
      req.teslaToken,
      `/api/1/vehicles/${req.params.id}/charge_history`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch charging history' });
  }
});

// One-time script to register QuagoEV as a Tesla Fleet API partner.
//
// Usage: DOMAIN=yourdomain.com node server/register-partner.js
//
// Before running, host your public key at:
//   https://{DOMAIN}/.well-known/appspecific/com.tesla.3p.public-key.pem
//
// The public key file is at: keys/public-key.pem

import 'dotenv/config';

const DOMAIN = process.env.DOMAIN;
const FLEET_API = process.env.TESLA_FLEET_API || 'https://fleet-api.prd.na.vn.cloud.tesla.com';

if (!DOMAIN) {
  console.error('Error: DOMAIN environment variable is required.');
  console.error('Usage: DOMAIN=yourdomain.com node server/register-partner.js');
  process.exit(1);
}

async function register() {
  // Step 1: Get client credentials token
  console.log('Getting client credentials token...');
  const tokenRes = await fetch('https://auth.tesla.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TESLA_CLIENT_ID,
      client_secret: process.env.TESLA_CLIENT_SECRET,
      scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds',
      audience: FLEET_API,
    }),
  });

  if (!tokenRes.ok) {
    console.error('Failed to get token:', await tokenRes.text());
    process.exit(1);
  }

  const { access_token } = await tokenRes.json();
  console.log('Got access token.');

  // Step 2: Register partner account
  console.log(`Registering partner with domain: ${DOMAIN}...`);
  const regRes = await fetch(`${FLEET_API}/api/1/partner_accounts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain: DOMAIN }),
  });

  const data = await regRes.json();
  console.log('Response:', JSON.stringify(data, null, 2));

  if (regRes.ok) {
    console.log('\nPartner registration successful! Your app can now access the Fleet API.');
  } else {
    console.error('\nRegistration failed. Make sure your public key is hosted at:');
    console.error(`  https://${DOMAIN}/.well-known/appspecific/com.tesla.3p.public-key.pem`);
  }
}

register().catch(console.error);

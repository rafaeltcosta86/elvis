/**
 * Gmail OAuth Bootstrap Script
 *
 * Run once to authorize Elvis to access Gmail.
 * Uses localhost loopback redirect (Google "Desktop app" OAuth type).
 *
 * Prerequisites:
 *   1. Create a "Desktop app" OAuth 2.0 credential in Google Cloud Console
 *      Scopes: gmail.readonly, gmail.send
 *   2. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/api/.env
 *   3. Set OAUTH_ENC_KEY (64 hex chars) in apps/api/.env
 *
 * Usage:
 *   pnpm --filter api ts-node src/scripts/gmail-oauth-bootstrap.ts
 */

import * as http from 'http';
import { google } from 'googleapis';
import { storeTokenForProvider } from '../lib/oauthService';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
    process.exit(1);
  }

  // Start a local HTTP server on a random port to capture the OAuth code
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const port = (server.address() as any).port as number;
  const redirectUri = `http://localhost:${port}`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force refresh_token to be returned
  });

  console.log('\n=== Gmail OAuth Bootstrap ===');
  console.log('1. Open this URL in your browser:');
  console.log('\n  ' + authUrl + '\n');
  console.log('2. Authorize the app and wait for the redirect...');

  const code = await new Promise<string>((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (code) {
        res.end('<h1>Authorization successful! You can close this tab.</h1>');
        resolve(code);
      } else {
        res.end(`<h1>Authorization failed: ${error}</h1>`);
        reject(new Error(`OAuth error: ${error}`));
      }
    });
  });

  server.close();

  console.log('3. Exchanging code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('ERROR: No access_token or refresh_token returned. Try re-authorizing.');
    process.exit(1);
  }

  const blob = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  });

  await storeTokenForProvider('GOOGLE', blob);
  console.log('\n✅ Gmail token stored successfully!');
  console.log('Elvis can now read and send Gmail messages.\n');
}

main().catch((err) => {
  console.error('Bootstrap failed:', err.message);
  process.exit(1);
});

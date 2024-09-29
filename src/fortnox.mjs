import { FortnoxApiClient } from '@rantalainen/fortnox-api-client';
import express from 'express';
import { exec } from 'child_process';
import nconf from 'nconf';
import dayjs from 'dayjs';
import axios from 'axios';

const clientId = nconf.get('fortnox:clientId');
const clientSecret = nconf.get('fortnox:clientSecret');

const redirectUri = 'http://localhost:3000/callback';
const app = express();

export async function initFortnox() {
  console.log('Init Fortnox');
  let tokenExists = nconf.get('fortnox:accessToken') !== undefined;
  let authenticateRequired = true;

  if (tokenExists) {
    const accessTokenTimestamp = nconf.get('fortnox:accessTokenTimestamp');
    const dateNow = new Date().toISOString();

    if (calcDateDiff(dateNow, accessTokenTimestamp, 'minutes') > 50) {
      const refreshTokenTimestamp = nconf.get('fortnox:refreshTokenTimestamp');

      if (calcDateDiff(dateNow, refreshTokenTimestamp, 'days') > 44) {
        console.log('Refresh and access token are no longer valid, full reauth required');

      } else {
        console.log('Access token is no longer valid, refreshing now . . .');
        authenticateRequired = false;
        await refreshAccessToken(nconf.get('fortnox:refreshToken'));
      }
    } else {
      authenticateRequired = false;
    }
  }

  if (authenticateRequired) {
    const server = app.listen(3000);
    await runFullAuthenticate();
    server.close();
  }

  console.log('Fortnox has been loaded!');
  console.log('');
}

function calcDateDiff(_date1, _date2, unit) {
  const date1 = dayjs(_date1)
  const date2 = dayjs(_date2)

  return date1.diff(date2, unit);
}

export function getAccessToken() {
  return nconf.get('fortnox:accessToken');
}

async function runFullAuthenticate() {
  console.log('Running authenticate');

  return new Promise((resolve) => {
    const authorizationUri = FortnoxApiClient.createAuthorizationUri(
      clientId,
      redirectUri,
      ['bookkeeping'],
      'state1234',
      'service'
    );

    openAuthorizationUri(authorizationUri);

    app.get('/callback', async (req, res) => {
      const authCode = req.query.code;

      if (authCode) {
        try {
          res.send('Authorization successful! You may close this window.');

          const tokens = await FortnoxApiClient.getTokensByAuthorizationCode(
            clientId,
            clientSecret,
            redirectUri,
            authCode
          );

          setTokens(tokens.accessToken, tokens.refreshToken);
          console.log('Authorization successful!');
        } catch (error) {
          console.error('Error fetching tokens:', error);
          res.status(500).send('Error fetching tokens!');
        }
      } else {
        console.error('Authorization code not found!');
        res.status(400).send('Authorization code not found!');
      }

      resolve('OK');
    });
  });
}

function openAuthorizationUri(uri) {
  exec(`start "" "${uri}"`, (err) => {
    if (err) {
      console.error('Failed to open browser:', err);
      process.exit(1);
    }
  });
}

async function refreshAccessToken(refreshToken) {
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post('https://api.fortnox.se/oauth-v1/token', new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
    });

    const { access_token, refresh_token, expires_in } = response.data;

    console.log('Tokens have successfully been refreshed!')
    setTokens(access_token, refresh_token);

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error.response ? error.response.data : error.message);
  }
}

function setTokens(accessToken, refreshToken) {
  const dateNow = new Date().toISOString();

  nconf.set('fortnox:accessToken', accessToken);
  nconf.set('fortnox:accessTokenTimestamp', dateNow);
  nconf.set('fortnox:refreshToken', refreshToken);
  nconf.set('fortnox:refreshTokenTimestamp', dateNow);

  nconf.save();
}

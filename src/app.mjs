import cron from 'node-cron';
import { runZRapportSync } from './zrapport.mjs';
import { fetchPayouts } from './payouts.mjs';
import { initFortnox } from './fortnox.mjs';
import nconf from 'nconf';
import dayjs from 'dayjs';

const debug = true;
const dryRun = false;

nconf.file({ file: 'config.json' });

const endpoint = nconf.get('shopify:endpoint');
const accessToken = nconf.get('shopify:access_token');

//Z-rapport

//cron.schedule('0 0 * * *', generateZRapport)

console.log('shopify-integration');
if (dryRun) console.log('WARN: Dry run activated');
console.log('');

await initFortnox();

await fetchPayouts(endpoint, accessToken, dryRun, debug);
await runZRapportSync(endpoint, accessToken, dryRun, debug);

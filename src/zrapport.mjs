import dayjs from 'dayjs';
import { GraphQLClient } from 'graphql-request';
import { getAccessToken } from './fortnox.mjs';
import axios from 'axios';
import nconf from 'nconf';

export async function runZRapportSync(endpoint, access_token, dryRun, debug) {
  console.log('zrapport.mjs init');
  const accessToken = getAccessToken();
  let yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday = dayjs(yesterday);

  let yesterdayFormatted = yesterday.format('YYYY-MM-DD');
  let syncDateStart = nconf.get('zrapport:latestSyncDate');

  if (syncDateStart == undefined) {
    nconf.set('zrapport:latestSyncDate', yesterdayFormatted);
    syncDateStart = yesterday;
    nconf.save();
  } else {
    syncDateStart = dayjs(syncDateStart);
  }

  const existingRapports = await fetchExistingRapports(syncDateStart.format('YYYY-MM-DD'), yesterdayFormatted, accessToken);
  const rapportToSyncList = [];
  let dateLoop = syncDateStart;
  let dayCount = 0;

  while (dateLoop.isBefore(yesterday) || dateLoop.isSame(yesterday)) {
    dayCount++;
    const testDate = dateLoop.format('YYYY-MM-DD');
    let found = false;

    for (const rapport of existingRapports) {
      if (rapport.TransactionDate == testDate) {
        found = true;
        break;
      }
    }

    if (!found) {
      rapportToSyncList.push(testDate);
    }

    dateLoop = dateLoop.add(1, 'day');
  }

  const dailyReports = [];
  let reportCreatedCount = 0;
  let skippedReportsCount = 0;

  const qlClient = new GraphQLClient(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': access_token
    }
  });

  for (const date of rapportToSyncList) {
    const dayReport = await fetchShopifyDailyReport(date, qlClient, debug);

    // No zero reporting
    if (dayReport.total > 0) {
      dailyReports.push(dayReport);
    } else {
      skippedReportsCount++;
    }
  }

  if (!dryRun) {
    for (const rapport of dailyReports) {
      await sendZRapportToFortnox(rapport);
      reportCreatedCount++;
    }
  }

  console.log(`Total days:      ${dayCount}`);
  console.log(`Start date:      ${syncDateStart.format('YYYY-MM-DD')}`);
  console.log(`End date:        ${yesterdayFormatted}`);
  console.log('---');
  console.log(`Total reports:   ${reportCreatedCount + skippedReportsCount}`);
  console.log(`Synced reports:  ${reportCreatedCount}`);
  console.log(`Skipped reports: ${skippedReportsCount}`);
  if (dryRun) console.log(`WARN: Dry run activated!`);
  console.log('Report sync complete!');

  nconf.set('zrapport:latestSyncDate', yesterdayFormatted);
  nconf.save();
}

async function fetchShopifyDailyReport(date, qlClient, debug) {
  const query = `
  query {
    orders(first: 250, query: "created_at:${date}", sortKey: CREATED_AT) {
      edges {
        node {
          totalPriceSet { shopMoney { amount } }
          currentTaxLines { priceSet { shopMoney { amount } } }
        }
      }
    }
  }
  `;

  try {
    const response = await qlClient.request(query);

    const totalAmounts = response.orders.edges.map(edge =>
      parseFloat(edge.node.totalPriceSet.shopMoney.amount)
    );

    let total = totalAmounts.reduce((sum, amount) => sum + amount, 0);
    total = formatNumber(total);

    const vatAmounts = response.orders.edges.flatMap(edge =>
      edge.node.currentTaxLines.map(taxLine => parseFloat(taxLine.priceSet.shopMoney.amount) || 0)
    );
    const vat = formatNumber(vatAmounts.reduce((sum, amount) => sum + amount, 0));
    const netto = formatNumber(total - vat);

    const dayReport = new DailyReport(date, total, netto, vat);
    if (debug) console.log(dayReport);
    return dayReport;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function fetchExistingRapports(startDate, endDate, accessToken) {
  try {
    const response = await axios.get('https://api.fortnox.se/3/vouchers/sublist/F', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      params: {
        fromdate: startDate,
        todate: endDate
      },
    });

    return response.data.Vouchers;
  } catch (error) {
    console.error('Error searching for Z-rapport:', error.response?.data || error.message);
    return [];
  }
}

async function sendZRapportToFortnox(dayReport) {
  const accessToken = getAccessToken();

  const voucherData =
  {
    Voucher: {
      Description: `Z-rapport ${dayReport.date}`,
      VoucherSeries: 'F',
      TransactionDate: dayReport.date,

      VoucherRows: [
        {
          Account: 1580,
          Debit: dayReport.total,
        },
        {
          Account: 3001,
          Credit: dayReport.netto,
        },
        {
          Account: 2611,
          Credit: dayReport.vat,
        }
      ]
    }
  }

  try {
    const response = await axios.post('https://api.fortnox.se/3/vouchers', voucherData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  } catch (error) {
    console.error(`Error creating z-rapport for date ${dayReport.date}!`, error.response?.data || error.message);
  }
}

function formatNumber(value) {
  return parseFloat(value.toFixed(2));
}

class DailyReport {
  constructor(date, total, netto, vat) {
    this.date = date;
    this.total = total;
    this.netto = netto;
    this.vat = vat;
  }
}

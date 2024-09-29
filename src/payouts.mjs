import dayjs from 'dayjs';
import { GraphQLClient } from 'graphql-request';
import axios from 'axios';
import { getAccessToken } from './fortnox.mjs';

export async function fetchPayouts(endpoint, shopify_access_token, dryRun, debug) {
  console.log('payouts.mjs init');
  console.log('Fetching Shopify Payment payouts...');

  let maxSearchDate = new Date();
  maxSearchDate.setDate(maxSearchDate.getDate() - 7);
  maxSearchDate = dayjs(maxSearchDate).format('YYYY-MM-DD');

  const client = new GraphQLClient(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify_access_token
    }
  });

  const query = `
  {
    shopifyPaymentsAccount {
      payouts(first: 10 query: "status:paid issued_at:>${maxSearchDate}") {
        edges {
          node {
            id
            issuedAt

            summary {
              chargesFee { amount }
              chargesGross { amount }
              refundsFeeGross { amount }
            }
          }
        }
      }
    }
  }`;

  try {
    const response = await client.request(query);
    const payouts = response.shopifyPaymentsAccount.payouts.edges;
    const payoutList = [];

    if (payouts.length > 0) {
      payouts.forEach(edge => {
        const node = edge.node;

        const date = dayjs(node.issuedAt).format('YYYY-MM-DD');
        const lastSlashIdx = node.id.lastIndexOf('/');
        const id = node.id.substring(lastSlashIdx + 1);

        const returns = Math.abs(node.summary.refundsFeeGross.amount);
        let total = node.summary.chargesGross.amount;
        const fees = node.summary.chargesFee.amount;

        if (returns > 0) formatNumber(total = total - returns);

        const netto = formatNumber(total - fees);
        const payout = new Payout(id, date, total, netto, fees, returns);
        payoutList.push(payout);

        if (debug) {
          console.log(`ID: ${id} | Issued At: ${date} | Totalt: ${total} | Utbetalat: ${netto} | Avgifter: ${fees} | Returer: ${returns}`);
        }
      });

      if (!dryRun) {
        await processPayouts(payoutList);
      }
    } else {
      console.log('No Shopify Payments payouts were found, skipping');
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

async function processPayouts(payouts) {
  const accessToken = getAccessToken();
  let payoutCreatedNum = 0;

  for (const payout of payouts) {
    try {
      const response = await axios.get(`https://api.fortnox.se/3/vouchers/sublist/SP`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
        params: {
          fromdate: payout.date,
          todate: payout.date
        },
      });

      let vouchers = response.data.Vouchers || [];

      if (vouchers.length > 0) {
        let foundVoucher = false;

        for (const voucher of vouchers) {
          if (voucher.Description.includes(payout.id)) {
            foundVoucher = true;
            break;
          }
        }

        if (!foundVoucher) {
          await createPayoutVoucher(payout, accessToken);
          payoutCreatedNum++;
        }
      } else {
        await createPayoutVoucher(payout, accessToken);
        payoutCreatedNum++;
      }
    } catch (error) {
      console.error('Error searching for SP payouts:', error.response?.data || error.message);
    }
  }

  console.log(`${payoutCreatedNum} st payout(s) have been created`);
  console.log('');
}

async function createPayoutVoucher(payout, accessToken) {
  const voucherData =
  {
    Voucher: {
      Description: `SP fordran ${payout.id}`,
      VoucherSeries: 'SP',
      TransactionDate: payout.date,

      VoucherRows: [
        {
          Account: 1930,
          Debit: payout.netto,
        },
        {
          Account: 1580,
          Credit: payout.total,
        },
        {
          Account: 6060,
          Debit: payout.fees
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

    console.log(`Voucher for SP ID ${payout.id} created!`);
  } catch (error) {
    console.error(`Error creating SP payout ${payout.id} voucher: `, error.response?.data || error.message);
  }
}

function formatNumber(value) {
  return parseFloat(value.toFixed(2));
}

class Payout {
  constructor(id, date, total, netto, fees, returns) {
    this.id = id;
    this.date = date;
    this.total = total;
    this.netto = netto;
    this.fees = fees;
    this.returns = returns;
  }
}

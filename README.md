# shopify-integration

App to sync Shopify with Fortnox book keeping.

## Features

- Sync daily reportings
- Sync Shopify Payments payouts

## Installation

1. Install npm + node.js if needed
2. Run `npm install` to install dependencies
3. Setup Shopify secrets in `config.json` (see below for default file). Get your API token from Shopify admin, only allow it the access required
4. Run app with `node .\app.mjs`

## Current limitations & Be aware

- It stores secrets in plaintext, perhaps not ideal
- Not accounting properly for returns, currently returns are just substracted from payouts amount. They should be book keeped in an seperate account
- It does not support multiple countries. All sales & VAT goes to one account. Seperating sale and VAT depending on customer invoice adress needs to be implemented
- Fortnox auth requires GUI, Oauth might need rewrite to be put on server
- cron jobs are not implemented

## `config.json` default

```json
{
  "shopify": {
    "endpoint": "https://xxxxxxxx.myshopify.com/admin/api/2024-07/graphql.json",
    "access_token": "xxxxxxxxxx"
  },
}
```

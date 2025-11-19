// utils/shopifyApi.js

const axios = require('axios');

// Ensure these are set in your environment variables
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function fetchShopifyData(graphqlQuery, variables) {
  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error("Shopify URL or Access Token is not defined in environment variables.");
  }

  try {
    const response = await axios.post(
      SHOPIFY_STORE_URL,
      { query: graphqlQuery, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        }
      }
    );

    if (response.data.errors) {
      console.error("Shopify GraphQL Errors:", response.data.errors);
      throw new Error(response.data.errors.map(err => err.message).join(', '));
    }

    return response.data.data;

  } catch (error) {
    console.error("Error calling Shopify GraphQL API:", error.message);
    if (error.response) {
      console.error("Shopify API Response Error:", error.response.status, error.response.data);
      throw new Error(`Shopify API responded with status ${error.response.status}`);
    }
    throw new Error(`Network or unexpected error during Shopify API call: ${error.message}`);
  }
}

const ORDER_FRAGMENT = `
  fragment OrderFragment on Order {
    id
    name 
    processedAt
    displayFinancialStatus
    displayFulfillmentStatus
    tags
    customer { 
      firstName
      lastName
      email
      phone
    }
    subtotalPriceSet { shopMoney { amount, currencyCode } }
    totalTaxSet { shopMoney { amount, currencyCode } }
    totalShippingPriceSet { shopMoney { amount, currencyCode } }
    totalPriceSet { shopMoney { amount, currencyCode } }
    totalDiscountsSet { shopMoney { amount, currencyCode } }
    shippingAddress {
      address1
      address2
      city
      provinceCode
      zip
      country
    }
    lineItems(first: 250) {
      edges {
        node {
          id
          title
          quantity
          requiresShipping
          variant { 
            title 
            product {
              productType
            }
          }
          originalUnitPriceSet { shopMoney { amount, currencyCode } }
          discountedTotalSet { shopMoney { amount, currencyCode } }
          discountAllocations {
            allocatedAmountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
    fulfillments(first: 10) {
      createdAt
      displayStatus
      trackingInfo(first: 1) {
        company
        number
        url
      }
      fulfillmentLineItems(first: 100) {
        edges {
          node {
            lineItem {
              id
            }
          }
        }
      }
    }
  }
`;

const GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY = `
  ${ORDER_FRAGMENT}
  query getCustomerAndLastOrderByPhone($phoneQuery: String!) {
    customers(first: 1, query: $phoneQuery) {
      edges {
        node {
          firstName
          lastName
          email 
          orders(first: 1, sortKey: PROCESSED_AT, reverse: true) {
            edges {
              node {
                ...OrderFragment
              }
            }
          }
        }
      }
    }
  }
`;


const GET_ORDER_BY_ID_QUERY = `
  ${ORDER_FRAGMENT}
  query getOrderById($nameQuery: String!) {
    orders(first: 1, query: $nameQuery) {
      edges {
        node {
          ...OrderFragment
        }
      }
    }
  }
`;

module.exports = {
  fetchShopifyData,
  GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY,
  GET_ORDER_BY_ID_QUERY,
};
const axios = require('axios');

// Ensure these are set in your environment variables
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

/**
 * A robust function to call the Shopify GraphQL API.
 * @param {string} graphqlQuery - The GraphQL query string.
 * @param {object} variables - The variables for the GraphQL query.
 * @returns {Promise<object>} - The data from the Shopify API.
 */
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

/**
 * The single, comprehensive GraphQL query to find a customer by their phone number
 * and then retrieve their most recent order along with all necessary details.
 * This is a more reliable method than querying orders directly by phone.
 */
const GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY = `
  query getCustomerAndLastOrderByPhone($phoneQuery: String!) {
    customers(first: 1, query: $phoneQuery) {
      edges {
        node {
          # Get customer details for context
          firstName
          lastName
          phone
          # Now, get the LATEST order belonging to this customer
          orders(first: 1, sortKey: PROCESSED_AT, reverse: true) {
            edges {
              node {
                id
                name # This is the order number like #1001
                processedAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                shippingAddress {
                  address1
                  address2
                  city
                  provinceCode
                  zip
                  country
                }
                lineItems(first: 10) {
                  edges {
                    node {
                      title
                      quantity
                    }
                  }
                }
                fulfillments(first: 5, sortKey: CREATED_AT, reverse: true) {
                  createdAt
                  displayStatus
                  trackingInfo(first: 1) {
                    company
                    number
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// A separate, simpler query for getting an order by its number (name)
const GET_ORDER_BY_ID_QUERY = `
  query getOrderById($nameQuery: String!) {
    orders(first: 1, query: $nameQuery) {
      edges {
        node {
          id
          name
          processedAt
          customer {
            firstName
            lastName
          }
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          shippingAddress {
            address1
            address2
            city
            provinceCode
            zip
            country
          }
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
              }
            }
          }
          fulfillments(first: 5, sortKey: CREATED_AT, reverse: true) {
            createdAt
            displayStatus
            trackingInfo(first: 1) {
              company
              number
              url
            }
          }
        }
      }
    }
  }
`;


module.exports = {
  fetchShopifyData,
  GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY,
  GET_ORDER_BY_ID_QUERY
};

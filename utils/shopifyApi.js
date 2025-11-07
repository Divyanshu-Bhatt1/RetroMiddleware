const axios = require('axios');

// Ensure these are set in your .env file
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
 * The single, comprehensive GraphQL query to fetch all necessary order details.
 * It retrieves order info, customer name, pricing, shipping address, line items,
 * and the latest fulfillment status and tracking information.
 */
const GET_ORDER_QUERY = `
  query getOrderByQuery($queryString: String!) {
    orders(first: 1, sortKey: PROCESSED_AT, reverse: true, query: $queryString) {
      edges {
        node {
          id
          name
          processedAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            firstName
            lastName
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
          # Fetch recent fulfillments (we will sort them in the backend)
          fulfillments(first: 5) { # <-- THIS IS THE FIX
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
  GET_ORDER_QUERY
};

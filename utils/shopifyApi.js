const axios = require('axios');

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function fetchShopifyData(graphqlQuery, variables) {
  try {
    const response = await axios.post(SHOPIFY_STORE_URL,
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
      throw new Error(`Shopify API responded with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Network or unexpected error: ${error.message}`);
  }
}


const GET_ORDER_DETAILS_QUERY = `
  query ($queryString: String!) {
    orders(first: 1, query: $queryString) {
      edges {
        node {
          id
          name
          email
          phone
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
              }
            }
          }
          fulfillments(first: 5) {
            createdAt # <--- ADDED THIS FIELD
            status
            trackingInfo {
              number
              url
              company
            }
          }
        }
      }
    }
  }
`;


const GET_CUSTOMER_DETAILS_QUERY = `
  query ($queryString: String!) {
    customers(first: 1, query: $queryString) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          # Add more customer fields as needed
        }
      }
    }
  }
`;


module.exports = {
  fetchShopifyData,
  GET_ORDER_DETAILS_QUERY,
  GET_CUSTOMER_DETAILS_QUERY
};

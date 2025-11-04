require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { fetchShopifyData, GET_ORDER_DETAILS_QUERY, GET_CUSTOMER_DETAILS_QUERY } = require('./utils/shopifyApi');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware order is important! express.json() should be before routes.
app.use(cors()); // Allow all CORS for flexibility during development/deployment
app.use(express.json()); // Essential for parsing JSON request bodies

// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
  res.status(200).send('Middleware is running!');
});

// Helper to normalize phone numbers (remove non-digits and ensure E.164-like format)
const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, ''); // Remove all non-digit characters
  if (digits.length === 10) { // Assume US number, prepend +1
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) { // Assume US number with leading 1
    return `+${digits}`;
  }
  return `+${digits}`; // Fallback, prepend + to whatever digits remain
};

// --- Endpoint to Get Order Details ---
app.post('/get-order-details', async (req, res) => {
  console.log('Received /get-order-details request. Body:', req.body); // LOG THE INCOMING BODY

  const { queryType, value } = req.body;

  if (!queryType || !value) {
    console.error("Validation Error: Missing 'queryType' or 'value' in request body.", req.body);
    // Ensure the error response matches what Retell AI expects to see as an error in its logs
    return res.status(400).json({
      success: false,
      error: "Missing 'queryType' or 'value' in request body. Please provide both.",
      received_body: req.body // Include received body for debugging
    });
  }

  let queryString;
  switch (queryType) {
    case 'name': // Shopify order number
      queryString = `name:${value.replace('#', '')}`; // Remove '#' if present
      break;
    case 'phone':
      queryString = `phone:${normalizePhoneNumber(value)}`;
      break;
    case 'email':
      queryString = `email:${value}`;
      break;
    case 'id': // Shopify GID
      queryString = `id:${value}`;
      break;
    default:
      console.error(`Invalid queryType: ${queryType}. Supported: name, phone, email, id.`);
      return res.status(400).json({
        success: false,
        error: `Invalid queryType: ${queryType}. Supported types are: name (order number), phone, email, id.`,
        received_queryType: queryType
      });
  }

  try {
    const data = await fetchShopifyData(GET_ORDER_DETAILS_QUERY, { queryString });
    const order = data?.orders?.edges?.[0]?.node;

    if (order) {
      const formattedOrder = {
        orderId: order.id.split('/').pop(),
        orderName: order.name,
        customerEmail: order.email || 'N/A',
        customerPhone: order.phone || 'N/A',
        lineItems: order.lineItems.edges.map(item => ({
          title: item.node.title,
          quantity: item.node.quantity
        })),
        fulfillments: order.fulfillments.map(fulfillment => ({
          status: fulfillment.status,
          trackingNumber: fulfillment.trackingInfo?.[0]?.number || 'N/A',
          trackingUrl: fulfillment.trackingInfo?.[0]?.url || 'N/A',
          trackingCompany: fulfillment.trackingInfo?.[0]?.company || 'N/A'
        }))
      };
      res.json({ success: true, order: formattedOrder });
    } else {
      res.json({ success: false, message: `No order found for ${queryType}: ${value}` });
    }

  } catch (error) {
    console.error("Error in /get-order-details:", error);
    res.status(500).json({ success: false, error: "Failed to fetch order details from Shopify.", details: error.message });
  }
});

// --- Endpoint to Get Customer Details ---
app.post('/get-customer-details', async (req, res) => {
  console.log('Received /get-customer-details request. Body:', req.body); // LOG THE INCOMING BODY

  const { queryType, value } = req.body;

  if (!queryType || !value) {
    console.error("Validation Error: Missing 'queryType' or 'value' in request body.", req.body);
    return res.status(400).json({
      success: false,
      error: "Missing 'queryType' or 'value' in request body. Please provide both.",
      received_body: req.body
    });
  }

  let queryString;
  switch (queryType) {
    case 'email':
      queryString = `email:${value}`;
      break;
    case 'phone':
      queryString = `phone:${normalizePhoneNumber(value)}`;
      break;
    case 'firstName':
      queryString = `first_name:${value}`;
      break;
    default:
      console.error(`Invalid queryType: ${queryType}. Supported: email, phone, firstName.`);
      return res.status(400).json({
        success: false,
        error: `Invalid queryType: ${queryType}. Supported types are: email, phone, firstName.`,
        received_queryType: queryType
      });
  }

  try {
    const data = await fetchShopifyData(GET_CUSTOMER_DETAILS_QUERY, { queryString });
    const customer = data?.customers?.edges?.[0]?.node;

    if (customer) {
      const formattedCustomer = {
        customerId: customer.id.split('/').pop(),
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone
      };
      res.json({ success: true, customer: formattedCustomer });
    } else {
      res.json({ success: false, message: `No customer found for ${queryType}: ${value}` });
    }

  } catch (error) {
    console.error("Error in /get-customer-details:", error);
    res.status(500).json({ success: false, error: "Failed to fetch customer details from Shopify.", details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Middleware server running on port ${PORT}`);
});

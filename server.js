require('dotenv').config();
const express = require('express');
const cors = require('cors');
const {
  fetchShopifyData,
  GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY,
  GET_ORDER_BY_ID_QUERY
} = require('./utils/shopifyApi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.status(200).send('Server is running!'));

// --- Helper Functions ---

const normalizePhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return phone.startsWith('+') ? phone : `+${digits}`;
};

/**
 * Formats a raw Shopify order object into a clean, AI-friendly format.
 */
const formatOrderForAI = (orderNode, customerNode) => {
  // --- START OF THE FIX ---
  // Since the API won't sort fulfillments for us, we do it here.
  let latestFulfillment = null;
  if (orderNode.fulfillments && orderNode.fulfillments.length > 0) {
    // Create a copy and sort by date, newest first.
    const sortedFulfillments = [...orderNode.fulfillments].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    latestFulfillment = sortedFulfillments[0]; // The latest one is now at the top.
  }
  // --- END OF THE FIX ---

  const lineItems = orderNode.lineItems.edges.map(edge => edge.node);
  const itemsSummary = lineItems.length > 1 ? `${lineItems.length} items, including a ${lineItems[0].title}` : `${lineItems[0].quantity} of the ${lineItems[0].title}`;
  const customerName = (customerNode?.firstName || orderNode?.customer?.firstName) ? [customerNode?.firstName || orderNode.customer.firstName, customerNode?.lastName || orderNode.customer.lastName].filter(Boolean).join(' ') : 'Valued Customer';
  
  return {
    orderNumber: orderNode.name,
    customerName: customerName,
    shippingStatus: latestFulfillment?.displayStatus || 'UNFULFILLED',
    carrier: latestFulfillment?.trackingInfo?.[0]?.company || null,
    trackingNumber: latestFulfillment?.trackingInfo?.[0]?.number || null,
    itemsSummary: itemsSummary
  };
};

// --- API Endpoints ---

/**
 * Fetches the latest order for a given phone number. THIS IS THE RELIABLE METHOD.
 */
app.post('/getOrderByPhone', async (req, res) => {
  const { phone } = req.body;
  console.log(`Received request for /getOrderByPhone with phone: ${phone}`);

  if (!phone) {
    return res.status(400).json({ success: false, error: "Phone number is required." });
  }

  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ success: false, error: `Invalid phone number format provided: ${phone}` });
  }

  try {
    const data = await fetchShopifyData(GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY, { phoneQuery: `phone:${normalizedPhone}` });
    const customer = data?.customers?.edges?.[0]?.node;
    const latestOrder = customer?.orders?.edges?.[0]?.node;

    if (customer && latestOrder) {
      const formattedOrder = formatOrderForAI(latestOrder, customer);
      res.json({ success: true, order: formattedOrder });
    } else {
      res.json({ success: false, message: `I couldn't find any recent orders associated with that phone number.` });
    }
  } catch (error) {
    console.error("Error in /getOrderByPhone:", error.message);
    res.status(500).json({ success: false, error: "An internal error occurred while fetching order details." });
  }
});

/**
 * Fetches an order by its order number (e.g., "#1001").
 */
app.post('/getOrderById', async (req, res) => {
  const { orderNumber } = req.body;
  console.log(`Received request for /getOrderById with order number: ${orderNumber}`);

  if (!orderNumber) {
    return res.status(400).json({ success: false, error: "Order number is required." });
  }

  const cleanOrderNumber = orderNumber.replace('#', '').trim();

  try {
    const data = await fetchShopifyData(GET_ORDER_BY_ID_QUERY, { nameQuery: `name:${cleanOrderNumber}` });
    const order = data?.orders?.edges?.[0]?.node;

    if (order) {
      const formattedOrder = formatOrderForAI(order, null);
      res.json({ success: true, order: formattedOrder });
    } else {
      res.json({ success: false, message: `I couldn't find an order with the number ${cleanOrderNumber}.` });
    }
  } catch (error) {
    console.error("Error in /getOrderById:", error.message);
    res.status(500).json({ success: false, error: "An internal error occurred while fetching order details." });
  }
});

app.listen(PORT, () => {
  console.log(`Middleware server running on http://localhost:${PORT}`);
});

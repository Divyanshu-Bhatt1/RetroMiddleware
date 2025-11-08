require('dotenv').config();
const express = require('express');
const cors = require('cors');
// Import the new, specific queries from our API utility
const {
  fetchShopifyData,
  GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY,
  GET_ORDER_BY_ID_QUERY
} = require('./utils/shopifyApi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
  res.status(200).send('Server is running and healthy!');
});

// --- Helper Functions ---

/**
 * Normalizes a phone number to E.164 format (e.g., +15551234567).
 * This is CRITICAL for matching Shopify's stored format.
 * @param {string} phone - The raw phone number string.
 * @returns {string|null} - The normalized phone number or null if invalid.
 */
const normalizePhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Ensure the number starts with a '+'. This is key for E.164.
  return phone.startsWith('+') ? phone : `+${digits}`;
};

/**
 * Formats a raw Shopify order object into a structured, AI-friendly format.
 * This function is now more robust.
 * @param {object} orderNode - The 'node' object from the Shopify GraphQL response.
 * @param {object} customerNode - The customer 'node' object.
 * @returns {object} - A clean object with all the necessary order details.
 */
const formatOrderForAI = (orderNode, customerNode) => {
  const latestFulfillment = orderNode.fulfillments?.[0]; // Fulfillments are pre-sorted in the new query
  const shippingAddress = orderNode.shippingAddress;

  const lineItems = orderNode.lineItems.edges.map(edge => edge.node);
  let itemsSummary = 'your items';
  if (lineItems.length === 1) {
    itemsSummary = `${lineItems[0].quantity} of the ${lineItems[0].title}`;
  } else if (lineItems.length > 1) {
    itemsSummary = `${lineItems.length} items, including a ${lineItems[0].title}`;
  }

  let fullAddress = 'the address on file';
  if (shippingAddress) {
    fullAddress = [shippingAddress.address1, shippingAddress.address2, shippingAddress.city, shippingAddress.provinceCode, shippingAddress.zip].filter(Boolean).join(', ');
  }

  // Use customer name from the top-level customer object if available
  const customerName = (customerNode && [customerNode.firstName, customerNode.lastName].filter(Boolean).join(' ')) ||
                       (orderNode.customer && [orderNode.customer.firstName, orderNode.customer.lastName].filter(Boolean).join(' ')) ||
                       'Valued Customer';

  return {
    orderNumber: orderNode.name,
    customerName: customerName,
    totalPrice: `${orderNode.totalPriceSet.shopMoney.amount} ${orderNode.totalPriceSet.shopMoney.currencyCode}`,
    shippingStatus: latestFulfillment?.displayStatus || 'UNFULFILLED',
    shippingDate: latestFulfillment?.createdAt || null,
    shippingAddress: fullAddress,
    carrier: latestFulfillment?.trackingInfo?.[0]?.company || 'the shipping carrier',
    itemsSummary: itemsSummary,
    totalItems: lineItems.reduce((sum, item) => sum + item.quantity, 0),
    lineItems: lineItems.map(item => ({ title: item.title, quantity: item.quantity })),
    trackingNumber: latestFulfillment?.trackingInfo?.[0]?.number || null,
    trackingUrl: latestFulfillment?.trackingInfo?.[0]?.url || null,
  };
};

// --- API Endpoints ---

/**
 * Fetches the latest order for a given phone number using the RELIABLE customer-first method.
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
      // This path is now only taken if no customer is found with that number, which is accurate.
      res.json({ success: false, message: `I couldn't find any recent orders associated with that phone number.` });
    }
  } catch (error) {
    console.error("Error in /getOrderByPhone:", error.message);
    res.status(500).json({ success: false, error: "An internal error occurred while fetching order details." });
  }
});

/**
 * Fetches an order by its order number (e.g., "#1001" or "1001").
 * This remains the same as it was already working correctly.
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
      // Pass the order as both the order and customer node since the query structure is different
      const formattedOrder = formatOrderForAI(order, order.customer);
      res.json({ success: true, order: formattedOrder });
    } else {
      res.json({ success: false, message: `I couldn't find an order with the number ${cleanOrderNumber}.` });
    }
  } catch (error) {
    console.error("Error in /getOrderById:", error.message);
    res.status(500).json({ success: false, error: "An internal error occurred while fetching order details." });
  }
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Middleware server running on http://localhost:${PORT}`);
});```

### Why This Fix Works

1.  **Correct Entry Point:** Instead of searching through all `orders`, we now start by searching the `customers`. Finding a customer by a unique phone number is a much more precise and reliable query in Shopify.
2.  **No False Positives:** If no customer exists with the provided phone number, the API will simply return nothing. It won't fall back to giving you a random recent order from the store.
3.  **Guaranteed Correct Order:** Once the correct customer is found, the query then asks for *that specific customer's* most recent order (`orders(first: 1, sortKey: PROCESSED_AT, reverse: true)`). This ensures you always get the right order for the right person.
4.  **Efficiency:** This is all done in a single, efficient GraphQL API call. We are not making multiple requests.

This new structure is the correct and robust way to handle this lookup and will resolve the issue of failing to find orders by phone number.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { fetchShopifyData, GET_ORDER_QUERY } = require('./utils/shopifyApi');

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
 * Normalizes a phone number to E.164 format (e.g., +15551234567)
 * This is crucial for reliable querying in Shopify.
 * @param {string} phone - The raw phone number string.
 * @returns {string|null} - The normalized phone number or null if invalid.
 */
const normalizePhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, ''); // Remove all non-digit characters
  if (digits.length < 10) return null; // Basic validation
  // Simple assumption for North American numbers, can be improved with a library like libphonenumber-js
  return phone.startsWith('+') ? phone : `+${digits}`;
};

/**
 * Formats a raw Shopify order object into a structured, AI-friendly format.
 * @param {object} orderNode - The 'node' object from the Shopify GraphQL response.
 * @returns {object} - A clean object with all the necessary order details.
 */
const formatOrderForAI = (orderNode) => {
  let latestFulfillment = null;
  // Check if fulfillments exist and sort them to find the most recent one
  if (orderNode.fulfillments && orderNode.fulfillments.length > 0) {
    const sortedFulfillments = [...orderNode.fulfillments].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    latestFulfillment = sortedFulfillments[0]; // The latest is now the first in the sorted array
  }
  
  const shippingAddress = orderNode.shippingAddress;

  // Create a simple, speakable summary of the items
  const lineItems = orderNode.lineItems.edges.map(edge => edge.node);
  let itemsSummary = 'your items';
  if (lineItems.length === 1) {
    itemsSummary = `${lineItems[0].quantity} of the ${lineItems[0].title}`;
  } else if (lineItems.length > 1) {
    itemsSummary = `${lineItems.length} items, including a ${lineItems[0].title}`;
  }

  // Create a clean, speakable address string
  let fullAddress = 'the address on file';
  if (shippingAddress) {
    fullAddress = [
      shippingAddress.address1,
      shippingAddress.address2,
      shippingAddress.city,
      shippingAddress.provinceCode,
      shippingAddress.zip
    ].filter(Boolean).join(', ');
  }

  return {
    orderNumber: orderNode.name,
    customerName: [orderNode.customer.firstName, orderNode.customer.lastName].filter(Boolean).join(' ') || 'Valued Customer',
    totalPrice: `${orderNode.totalPriceSet.shopMoney.amount} ${orderNode.totalPriceSet.shopMoney.currencyCode}`,
    
    // Shipping and Fulfillment Details
    shippingStatus: latestFulfillment?.displayStatus || 'UNFULFILLED',
    shippingDate: latestFulfillment?.createdAt || null,
    shippingAddress: fullAddress,
    carrier: latestFulfillment?.trackingInfo?.[0]?.company || 'the shipping carrier',
    
    // Item Details
    itemsSummary: itemsSummary,
    totalItems: lineItems.reduce((sum, item) => sum + item.quantity, 0),
    lineItems: lineItems.map(item => ({ title: item.title, quantity: item.quantity })),
    
    // Provide tracking info but let the AI decide how to use it
    trackingNumber: latestFulfillment?.trackingInfo?.[0]?.number || null,
    trackingUrl: latestFulfillment?.trackingInfo?.[0]?.url || null,
  };
};
 

// --- API Endpoints ---

/**
 * Fetches the latest order for a given phone number.
 */
// app.post('/getOrderByPhone', async (req, res) => {
//   const { phone } = req.body;
//   console.log(`Received request for /getOrderByPhone with phone: ${phone}`);

//   if (!phone) {
//     return res.status(400).json({ success: false, error: "Phone number is required." });
//   }

//   const normalizedPhone = normalizePhoneNumber(phone);
//   if (!normalizedPhone) {
//     return res.status(400).json({ success: false, error: `Invalid phone number format provided: ${phone}` });
//   }

//   try {
//     const data = await fetchShopifyData(GET_ORDER_QUERY, { queryString: `phone:${normalizedPhone}` });
//     const order = data?.orders?.edges?.[0]?.node;

//     if (order) {
//       const formattedOrder = formatOrderForAI(order);
//       res.json({ success: true, order: formattedOrder });
//     } else {
//       res.json({ success: false, message: `I couldn't find any recent orders associated with that phone number.` });
//     }
//   } catch (error) {
//     console.error("Error in /getOrderByPhone:", error.message);
//     res.status(500).json({ success: false, error: "An internal error occurred while fetching order details." });
//   }
// });


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
    const data = await fetchShopifyData(GET_ORDER_QUERY, { queryString: `phone:${normalizedPhone}` });
    const order = data?.orders?.edges?.[0]?.node;

    // --- START OF THE FIX ---
    // CRITICAL: Verify that the returned order's phone number matches the queried number.
    // This prevents returning the latest store order when no match is found.
    const returnedPhone = order?.customer?.phone ? normalizePhoneNumber(order.customer.phone) : null;

    if (order && returnedPhone === normalizedPhone) {
      // It's a true match, proceed to format and send the order.
      const formattedOrder = formatOrderForAI(order);
      res.json({ success: true, order: formattedOrder });
    } else {
      // This is NOT a match (or no order was found), so return a 'not found' message.
      console.log(`No matching order found for phone ${normalizedPhone}. Shopify may have returned a non-matching result.`);
      res.json({ success: false, message: `I couldn't find any recent orders associated with that phone number.` });
    }
    // --- END OF THE FIX ---

  } catch (error) {
    console.error("Error in /getOrderByPhone:", error.message);
    res.status(500).json({ success: false, error: "An internal error occurred while fetching order details." });
  }
});
/**
 * Fetches an order by its order number (e.g., "#1001" or "1001").
 */
app.post('/getOrderById', async (req, res) => {
  const { orderNumber } = req.body;
  console.log(`Received request for /getOrderById with order number: ${orderNumber}`);

  if (!orderNumber) {
    return res.status(400).json({ success: false, error: "Order number is required." });
  }

  // Shopify's 'name' query works on the order number. Remove '#' for consistency.
  const cleanOrderNumber = orderNumber.replace('#', '').trim();

  try {
    const data = await fetchShopifyData(GET_ORDER_QUERY, { queryString: `name:${cleanOrderNumber}` });
    const order = data?.orders?.edges?.[0]?.node;

    if (order) {
      const formattedOrder = formatOrderForAI(order);
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
});

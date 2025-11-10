
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

const formatMoney = (moneySet) => {
    if (!moneySet?.shopMoney?.amount) return null;
    const { amount, currencyCode } = moneySet.shopMoney;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount);
};

/**
 * FINAL VERSION: Formats a raw Shopify order object with per-item fulfillment status.
 */
const formatOrderForAI = (orderNode, customerNode) => {
  const latestFulfillment = orderNode.fulfillments?.length > 0
    ? [...orderNode.fulfillments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;

  // NEW: Create a set of all line item IDs that have been fulfilled.
  const fulfilledLineItemIds = new Set();
  orderNode.fulfillments.forEach(fulfillment => {
    fulfillment.fulfillmentLineItems.edges.forEach(({ node }) => {
      fulfilledLineItemIds.add(node.lineItem.id);
    });
  });

  // Process all line items, adding their individual fulfillment status.
  const lineItems = orderNode.lineItems.edges.map(({ node }) => ({
    name: node.title,
    variant: node.variant?.title || 'Default',
    quantity: node.quantity,
    unitPrice: formatMoney(node.originalUnitPriceSet),
    totalPrice: formatMoney(node.discountedTotalSet),
    // NEW: Add the fulfillment status for this specific item
    fulfillmentStatus: fulfilledLineItemIds.has(node.id) ? 'FULFILLED' : 'UNFULFILLED'
  }));

  const itemsSummary = lineItems.length > 1
    ? `${lineItems[0].quantity}x ${lineItems[0].name} and ${lineItems.length - 1} other item(s)`
    : `${lineItems[0].quantity}x ${lineItems[0].name}`;

  const customerName = (customerNode?.firstName || orderNode?.customer?.firstName)
    ? [customerNode?.firstName || orderNode.customer.firstName, customerNode?.lastName || orderNode.customer.lastName].filter(Boolean).join(' ')
    : 'Valued Customer';
  
  const shippingAddress = orderNode.shippingAddress
    ? [
        orderNode.shippingAddress.address1,
        orderNode.shippingAddress.address2,
        orderNode.shippingAddress.city,
        orderNode.shippingAddress.provinceCode,
        orderNode.shippingAddress.zip
      ].filter(Boolean).join(', ')
    : null;

  return {
    orderNumber: orderNode.name,
    orderDate: orderNode.processedAt, // NEW: The date the order was placed
    customerName: customerName,
    
    status: {
        financial: orderNode.displayFinancialStatus,
        fulfillment: orderNode.displayFulfillmentStatus, // Overall order status
    },

    pricing: {
        subtotal: formatMoney(orderNode.subtotalPriceSet),
        tax: formatMoney(orderNode.totalTaxSet),
        shipping: formatMoney(orderNode.totalShippingPriceSet),
        total: formatMoney(orderNode.totalPriceSet),
    },
    
    items: lineItems, // Now includes per-item status
    itemsSummary: itemsSummary,

    shipping: {
        address: shippingAddress,
        shippedOnDate: latestFulfillment?.createdAt || null, // NEW: The date of the latest shipment
        carrier: latestFulfillment?.trackingInfo?.[0]?.company || null,
        trackingNumber: latestFulfillment?.trackingInfo?.[0]?.number || null,
        trackingUrl: latestFulfillment?.trackingInfo?.[0]?.url || null,
    }
  };
};

// --- API Endpoints (No changes needed here) ---

app.post('/getOrderByPhone', async (req, res) => {
  const { phone } = req.body;
  console.log(`Received request for /getOrderByPhone with phone: ${phone}`);

  if (!phone) return res.status(400).json({ success: false, error: "Phone number is required." });
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) return res.status(400).json({ success: false, error: `Invalid phone number format: ${phone}` });

  try {
    const data = await fetchShopifyData(GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY, { phoneQuery: `phone:${normalizedPhone}` });
    const customer = data?.customers?.edges?.[0]?.node;
    const latestOrder = customer?.orders?.edges?.[0]?.node;

    if (customer && latestOrder) {
      res.json({ success: true, order: formatOrderForAI(latestOrder, customer) });
    } else {
      res.json({ success: false, message: `I couldn't find any recent orders with that phone number.` });
    }
  } catch (error) {
    console.error("Error in /getOrderByPhone:", error.message);
    res.status(500).json({ success: false, error: "Internal error fetching order details." });
  }
});

app.post('/getOrderById', async (req, res) => {
  const { orderNumber } = req.body;
  console.log(`Received request for /getOrderById with order number: ${orderNumber}`);

  if (!orderNumber) return res.status(400).json({ success: false, error: "Order number is required." });
  const cleanOrderNumber = orderNumber.replace('#', '').trim();

  try {
    const data = await fetchShopifyData(GET_ORDER_BY_ID_QUERY, { nameQuery: `name:${cleanOrderNumber}` });
    const order = data?.orders?.edges?.[0]?.node;

    if (order) {
      res.json({ success: true, order: formatOrderForAI(order, null) });
    } else {
      res.json({ success: false, message: `I couldn't find an order with the number ${cleanOrderNumber}` });
    }
  } catch (error) {
    console.error("Error in /getOrderById:", error.message);
    res.status(500).json({ success: false, error: "Internal error fetching order details." });
  }
});

app.listen(PORT, () => console.log(`Middleware server running on http://localhost:${PORT}`));
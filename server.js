// server.js

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
    const money = moneySet?.shopMoney || moneySet;
    if (!money?.amount || parseFloat(money.amount) === 0) return null;
    
    const { amount, currencyCode } = money;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount);
};

const formatDate = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const parseShippingDateFromTags = (tags) => {
  if (!Array.isArray(tags)) return null;
  const dateTag = tags.find(tag => tag.toLowerCase().startsWith('w3dd:'));
  if (!dateTag) return null;
  const dateString = dateTag.split(':')[1]?.trim();
  if (!dateString) return null;
  const date = new Date(dateString + 'T00:00:00Z');
  if (isNaN(date.getTime())) return null;
  return formatDate(date.toISOString());
};

const formatOrderForAI = (orderNode, customerNode) => {
  const expectedShipDate = parseShippingDateFromTags(orderNode.tags);
  
  const latestFulfillment = orderNode.fulfillments?.length > 0
    ? [...orderNode.fulfillments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;
    
  const actualShippedDate = latestFulfillment?.createdAt ? formatDate(latestFulfillment.createdAt) : null;

  const fulfilledLineItemIds = new Set();
  orderNode.fulfillments.forEach(fulfillment => {
    fulfillment.fulfillmentLineItems.edges.forEach(({ node }) => {
      fulfilledLineItemIds.add(node.lineItem.id);
    });
  });

  const lineItems = orderNode.lineItems.edges.map(({ node }) => {
    const itemDiscountAmount = node.discountAllocations.reduce(
      (total, allocation) => total + parseFloat(allocation.allocatedAmountSet.shopMoney.amount),
      0
    );
    
    const physicalProductTypes = ["Embroidered Patches", "Alterations"];
    const productType = node.variant?.product?.productType || '';
    const isPhysical = node.requiresShipping || physicalProductTypes.includes(productType);

    return {
      name: node.title,
      variant: node.variant?.title || 'Default',
      quantity: node.quantity,
      unitPrice: formatMoney(node.originalUnitPriceSet),
      totalPrice: formatMoney(node.discountedTotalSet),
      discount: formatMoney({ shopMoney: { amount: itemDiscountAmount, currencyCode: node.originalUnitPriceSet.shopMoney.currencyCode } }),
      itemCategory: isPhysical ? 'PHYSICAL' : 'DIGITAL', 
      fulfillmentStatus: fulfilledLineItemIds.has(node.id) ? 'FULFILLED' : 'UNFULFILLED',
    };
  });
  
  const orderRequiresShipping = lineItems.some(item => item.itemCategory === 'PHYSICAL');

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
    orderDate: formatDate(orderNode.processedAt),
    customerName: customerName,
    status: {
        financial: orderNode.displayFinancialStatus,
        fulfillment: orderNode.displayFulfillmentStatus,
    },
    pricing: {
        subtotal: formatMoney(orderNode.subtotalPriceSet),
        shipping: formatMoney(orderNode.totalShippingPriceSet),
        tax: formatMoney(orderNode.totalTaxSet),
        totalDiscount: formatMoney(orderNode.totalDiscountsSet),
        total: formatMoney(orderNode.totalPriceSet),
    },
    items: lineItems,
    itemsSummary: itemsSummary,
    shippingInfo: orderRequiresShipping ? {
        isShippable: true,
        address: shippingAddress,
        statusMessage: expectedShipDate || actualShippedDate || "Awaiting shipment",
        carrier: latestFulfillment?.trackingInfo?.[0]?.company || null,
        trackingNumber: latestFulfillment?.trackingInfo?.[0]?.number || null,
        trackingUrl: latestFulfillment?.trackingInfo?.[0]?.url || null,
    } : {
        isShippable: false,
        address: null,
        statusMessage: "This order does not require shipping.",
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
    }
  };
};

// --- API Endpoints ---

app.post('/getOrderByPhone', async (req, res) => {
  const { phone } = req.body;
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
// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const {
  fetchShopifyData,
  GET_LATEST_ORDER_BY_CUSTOMER_PHONE_QUERY,
  GET_LATEST_ORDER_BY_CUSTOMER_EMAIL_QUERY,
  GET_ORDER_BY_ID_QUERY
} = require('./utils/shopifyApi');
const { 
  sendEscalationEmail,
  sendAddressChangeRequestEmail
} = require('./utils/emailService');

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
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

// --- MODIFIED FUNCTION ---
// server.js (updated section)

// --- MODIFIED FUNCTION ---
// server.js (updated section)

// --- CORRECTED FUNCTION ---
const formatOrderForAI = (orderNode, customerNode) => {
  const expectedShipDate = parseShippingDateFromTags(orderNode.tags);
  
  // Use the correct data access for fulfillments (as a direct array) and make it safe
  const latestFulfillment = orderNode.fulfillments?.length > 0
    ? [...orderNode.fulfillments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;
    
  const actualShippedDate = latestFulfillment?.createdAt ? formatDate(latestFulfillment.createdAt) : null;

  // --- FIX: Correctly build the set of fulfilled item IDs from the fulfillments array ---
  const fulfilledLineItemIds = new Set();
  
  // Iterate over `orderNode.fulfillments` directly, as it's an array. Add safety checks.
  orderNode.fulfillments?.forEach(fulfillment => {
    // The items within a fulfillment ARE a connection, so we access .edges here.
    fulfillment.fulfillmentLineItems?.edges?.forEach(({ node }) => {
      if (node.lineItem?.id) {
        fulfilledLineItemIds.add(node.lineItem.id);
      }
    });
  });

  // Safely map the line items and determine their individual fulfillment status
  const lineItems = (orderNode.lineItems?.edges?.map(({ node }) => {
    const itemDiscountAmount = node.discountAllocations.reduce(
      (total, allocation) => total + parseFloat(allocation.allocatedAmountSet.shopMoney.amount),
      0
    );
    
    const physicalProductTypes = ["Embroidered Patches", "Alterations"];
    const productType = node.variant?.product?.productType || '';
    const isPhysical = node.requiresShipping || physicalProductTypes.includes(productType);

    // Check if this item's ID is in our set of fulfilled IDs
    const itemFulfillmentStatus = fulfilledLineItemIds.has(node.id) ? 'FULFILLED' : 'UNFULFILLED';

    return {
      name: node.title,
      variant: node.variant?.title || 'Default',
      quantity: node.quantity,
      unitPrice: formatMoney(node.originalUnitPriceSet),
      totalPrice: formatMoney(node.discountedTotalSet),
      discount: formatMoney({ shopMoney: { amount: itemDiscountAmount, currencyCode: node.originalUnitPriceSet.shopMoney.currencyCode } }),
      itemCategory: isPhysical ? 'PHYSICAL' : 'DIGITAL', 
      fulfillmentStatus: itemFulfillmentStatus, // Assign the correct individual status
    };
  })) ?? []; // Default to an empty array if lineItems or edges are missing
  
  const orderRequiresShipping = lineItems.some(item => item.itemCategory === 'PHYSICAL');

  // Make itemsSummary safe for orders with zero items
  const itemsSummary = lineItems.length > 0
    ? lineItems.length > 1
      ? `${lineItems[0].quantity}x ${lineItems[0].name} and ${lineItems.length - 1} other item(s)`
      : `${lineItems[0].quantity}x ${lineItems[0].name}`
    : "No items found in this order.";

  const customerName = (customerNode?.firstName || orderNode?.customer?.firstName)
    ? [customerNode?.firstName || orderNode.customer.firstName, customerNode?.lastName || orderNode.customer.lastName].filter(Boolean).join(' ')
    : 'Valued Customer';
  
  const customerEmail = customerNode?.email || orderNode?.customer?.email || null;

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
    customerEmail: customerEmail,
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
// The endpoints below remain unchanged and will now work correctly with the fixed helper function.

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

app.post('/getOrderByEmail', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: "Email address is required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: `Invalid email format: ${email}` });
  }
  try {
    const data = await fetchShopifyData(GET_LATEST_ORDER_BY_CUSTOMER_EMAIL_QUERY, { emailQuery: `email:${email}` });
    const customer = data?.customers?.edges?.[0]?.node;
    const latestOrder = customer?.orders?.edges?.[0]?.node;
    if (customer && latestOrder) {
      res.json({ success: true, order: formatOrderForAI(latestOrder, customer) });
    } else {
      res.json({ success: false, message: `I couldn't find any recent orders associated with that email address.` });
    }
  } catch (error) {
    console.error("Error in /getOrderByEmail:", error.message);
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

app.post('/escalateToSupport', async (req, res) => {
  const { customerName, customerEmail, orderNumber, phoneNumber, issueSummary } = req.body;
  if (!issueSummary || !customerName || !phoneNumber) {
    return res.status(400).json({ 
      success: false, 
      error: "An issue summary, customer name, and phone number are required for escalation." 
    });
  }
  try {

//     console.log(`
// Customer Name: ${customerName}
// Customer Email: ${customerEmail}
// Order Number: ${orderNumber}
// Phone Number: ${phoneNumber}
// Issue Summary: ${issueSummary}
// `);


    await sendEscalationEmail({
      customerName,
      customerEmail,
      orderNumber,
      phoneNumber, 
      issueSummary
    });
    res.status(200).json({ 
      success: true, 
      message: "Escalation email has been sent to the support team." 
    });
  } catch (error) {
    console.error("Error in /escalateToSupport endpoint:", error.message);
    res.status(500).json({ 
      success: false, 
      error: "An internal server error occurred while trying to send the email." 
    });
  }
});

app.post('/requestAddressChange', async (req, res) => {
  const { orderNumber, customerName, customerEmail, phoneNumber, oldAddressDetails, newAddressDetails } = req.body;
  if (!orderNumber || !customerName || !phoneNumber || !oldAddressDetails || !newAddressDetails) {
    return res.status(400).json({
      success: false,
      error: "Order number, customer name, phone number, old address, and new address details are required."
    });
  }
  try {


//     console.log(`
// Order Number: ${orderNumber}
// Customer Name: ${customerName}
// Customer Email: ${customerEmail}
// Phone Number: ${phoneNumber}
// Old Address: ${oldAddressDetails}
// New Address: ${newAddressDetails}
// `);


    await sendAddressChangeRequestEmail({
      orderNumber,
      customerName,
      customerEmail,
      phoneNumber,
      oldAddressDetails,
      newAddressDetails
    });
    res.status(200).json({
      success: true,
      message: "Your address change request has been sent to our support team for review."
    });
  } catch (error) {
    console.error("Error in /requestAddressChange endpoint:", error.message);
    res.status(500).json({
      success: false,
      error: "An internal server error occurred while sending the address change request."
    });
  }
});

app.listen(PORT, () => console.log(`Middleware server running on http://localhost:${PORT}`));
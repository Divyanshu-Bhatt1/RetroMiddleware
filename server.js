require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { fetchShopifyData, GET_ORDER_DETAILS_QUERY, GET_CUSTOMER_DETAILS_QUERY } = require('./utils/shopifyApi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
  res.status(200).send('Middleware is running!');
});

// Helper to normalize phone numbers to E.164 format (+CountryCodeNumber)
// This is a more universal approach, but still relies on Twilio/Shopify's ability to handle various formats.
// For truly robust global phone number parsing, a dedicated library like 'libphonenumber-js' is recommended.
const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, ''); // Remove all non-digit characters

  // If the number already starts with '+', assume it's in E.164 or similar format
  if (phone.startsWith('+')) {
      return phone;
  }

  // If it's a very short sequence of digits, it's unlikely a full phone number.
  // This helps prevent normalizing things like "123" into "+123".
  if (digits.length < 7) {
      console.warn(`Attempted to normalize a short digit sequence: "${phone}". Returning as is.`);
      return phone; // Return as is, let Shopify/GraphQL handle it, or fail later.
  }

  // Common case: user provides a number without a leading '+'
  // If we can infer a country code (e.g., from an environment variable or context), we could add it.
  // For now, if no '+' is present, we'll just prepend '+' as a best guess for E.164.
  // This might not be perfect for all cases (e.g., if Shopify expects a very specific format without '+').
  // A better solution would involve knowing the expected country of origin or using a library.
  return `+${digits}`;
};

// Helper to format dates human-friendly
const formatDateHuman = (dateString) => {
    if (!dateString) return 'not yet available';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};

// Helper to estimate arrival date (very basic, can be improved)
const estimateArrivalDate = (shippingDateString) => {
    if (!shippingDateString) return 'not yet available';
    const shippingDate = new Date(shippingDateString);
    const arrivalDate = new Date(shippingDate);
    arrivalDate.setDate(shippingDate.getDate() + 7); // Add 7 days
    return arrivalDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

// --- NEW Endpoint: Get Order from Current Call Number (using query params) ---
app.get('/get-order-from-current-num', async (req, res) => {
  console.log('Received /get-order-from-current-num request. Query:', req.query);

  const { phoneNumber } = req.query; // Expecting 'phoneNumber' as a query parameter

  if (!phoneNumber) {
    console.error("Validation Error: Missing 'phoneNumber' query parameter.");
    return res.status(400).json({
      success: false,
      error: "Missing 'phoneNumber' query parameter.",
      received_query: req.query
    });
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) {
    console.warn(`Invalid or un-normalizeable phone number for order lookup: ${phoneNumber}`);
    return res.json({ success: false, message: `The provided phone number is not in a valid format.` });
  }

  const queryString = `phone:${normalizedPhone}`;

  try {
    const data = await fetchShopifyData(GET_ORDER_DETAILS_QUERY, { queryString });
    const order = data?.orders?.edges?.[0]?.node;

    if (order) {
        // --- Process Line Items for a humanized summary ---
        const lineItems = order.lineItems.edges.map(item => ({
            title: item.node.title,
            quantity: item.node.quantity
        }));
        let lineItemsSummary = '';
        if (lineItems.length === 1) {
            lineItemsSummary = `${lineItems[0].quantity} ${lineItems[0].title}`;
        } else if (lineItems.length > 1) {
            lineItemsSummary = `${lineItems.length} items, including the ${lineItems[0].title}`;
        } else {
            lineItemsSummary = 'your order';
        }

        // --- Process Fulfillments for shipping info ---
        let hasTracking = false;
        let trackingCompany = 'N/A';
        let latestFulfillmentStatus = 'UNFULFILLED'; // Default
        let shippingDate = null;
        let trackingNumber = null;
        let trackingUrl = null;

        if (order.fulfillments && order.fulfillments.length > 0) {
            const latestFulfillment = order.fulfillments[order.fulfillments.length - 1];
            latestFulfillmentStatus = latestFulfillment.status;
            shippingDate = latestFulfillment.createdAt;

            if (latestFulfillment.trackingInfo && latestFulfillment.trackingInfo.length > 0) {
                const primaryTracking = latestFulfillment.trackingInfo[0];
                if (primaryTracking.number) {
                    hasTracking = true;
                    trackingNumber = primaryTracking.number;
                    trackingUrl = primaryTracking.url;
                    trackingCompany = primaryTracking.company || 'the carrier';
                }
            }
        }
        
        const formattedShippingDate = shippingDate ? formatDateHuman(shippingDate) : 'not yet available';
        const formattedArrivalDate = shippingDate ? estimateArrivalDate(shippingDate) : 'not yet available';

      const formattedOrder = {
        orderId: order.id.split('/').pop(),
        orderName: order.name,
        customerEmail: order.email || 'N/A',
        customerPhone: order.phone || 'N/A',
        lineItemsSummary: lineItemsSummary,
        fulfillmentStatus: latestFulfillmentStatus,
        hasTracking: hasTracking,
        formattedShippingDate: formattedShippingDate,
        formattedArrivalDate: formattedArrivalDate,
        trackingCompany: trackingCompany,
        trackingNumber: trackingNumber,
        trackingUrl: trackingUrl,
        rawLineItems: lineItems,
      };
      res.json({ success: true, order: formattedOrder });
    } else {
      res.json({ success: false, message: `No order found for the provided phone number.` });
    }

  } catch (error) {
    console.error("Error in /get-order-from-current-num:", error);
    res.status(500).json({ success: false, error: "Failed to fetch order details from Shopify.", details: error.message });
  }
});

// --- Endpoint to Get Order Details ---
app.post('/get-order-details', async (req, res) => {
  console.log('Received /get-order-details request. Body:', req.body);

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
  let queryValue = value; // Use a variable for the actual value to be queried

  // Defensive check: If the AI is literally passing the variable name, reject it here.
  // if (typeof value === 'string' && (value.includes('current_call_number') || value.includes('{{'))) {
  //     console.error(`Rejected query: AI passed variable literal '${value}' instead of its value.`);
  //     return res.json({ success: false, message: `Invalid input provided. Please try again with a valid order number, email, or phone number.` });
  // }

 console.log(value, " string or not ", value === 'string');


  switch (queryType) {
    case 'name': // Shopify order number
      queryString = `name:${queryValue.replace('#', '')}`; // Remove '#' if present
      break;
    case 'phone':
      queryValue = normalizePhoneNumber(value);
      if (!queryValue) { // If normalization results in null (e.g., empty input)
          console.error(`Normalized phone number is null for input: ${value}`);
          return res.json({ success: false, message: `Invalid phone number format provided.` });
      }
      queryString = `phone:${queryValue}`;
      break;
    case 'email':
      queryString = `email:${queryValue}`;
      break;
    case 'id': // Shopify GID
      queryString = `id:${queryValue}`;
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
        const lineItems = order.lineItems.edges.map(item => ({
            title: item.node.title,
            quantity: item.node.quantity
        }));
        let lineItemsSummary = '';
        if (lineItems.length === 1) {
            lineItemsSummary = `${lineItems[0].quantity} ${lineItems[0].title}`;
        } else if (lineItems.length > 1) {
            lineItemsSummary = `${lineItems.length} items, including the ${lineItems[0].title}`;
        } else {
            lineItemsSummary = 'your order';
        }

        let hasTracking = false;
        let trackingCompany = 'N/A';
        let latestFulfillmentStatus = 'UNFULFILLED';
        let shippingDate = null;
        let trackingNumber = null;
        let trackingUrl = null;

        if (order.fulfillments && order.fulfillments.length > 0) {
            const latestFulfillment = order.fulfillments[order.fulfillments.length - 1];
            latestFulfillmentStatus = latestFulfillment.status;
            shippingDate = latestFulfillment.createdAt;

            if (latestFulfillment.trackingInfo && latestFulfillment.trackingInfo.length > 0) {
                const primaryTracking = latestFulfillment.trackingInfo[0];
                hasTracking = true;
                trackingNumber = primaryTracking.number;
                trackingUrl = primaryTracking.url;
                trackingCompany = primaryTracking.company || 'the carrier';
            }
        }
        
        const formattedShippingDate = shippingDate ? formatDateHuman(shippingDate) : 'not yet available';
        const formattedArrivalDate = shippingDate ? estimateArrivalDate(shippingDate) : 'not yet available';


      const formattedOrder = {
        orderId: order.id.split('/').pop(),
        orderName: order.name,
        customerEmail: order.email || 'N/A',
        customerPhone: order.phone || 'N/A',
        lineItemsSummary: lineItemsSummary,
        fulfillmentStatus: latestFulfillmentStatus,
        hasTracking: hasTracking,
        formattedShippingDate: formattedShippingDate,
        formattedArrivalDate: formattedArrivalDate,
        trackingCompany: trackingCompany,
        trackingNumber: trackingNumber,
        trackingUrl: trackingUrl,
        rawLineItems: lineItems,
      };
      res.json({ success: true, order: formattedOrder });
    } else {
      // Explicitly return success: false and a clear message for no order found
      res.json({ success: false, message: `No order found for ${queryType}: ${value}` });
    }

  } catch (error) {
    console.error("Error in /get-order-details:", error);
    res.status(500).json({ success: false, error: "Failed to fetch order details from Shopify.", details: error.message });
  }
});

// --- Endpoint to Get Customer Details ---
app.post('/get-customer-details', async (req, res) => {
  console.log('Received /get-customer-details request. Body:', req.body);

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
  let queryValue = value;

  // Defensive check: If the AI is literally passing the variable name, reject it here.
  if (typeof value === 'string' && (value.includes('current_call_number') || value.includes('{{'))) {
      console.error(`Rejected query: AI passed variable literal '${value}' instead of its value.`);
      return res.json({ success: false, message: `Invalid input provided. Please try again with a valid email or phone number.` });
  }

  switch (queryType) {
    case 'email':
      queryString = `email:${queryValue}`;
      break;
    case 'phone':
      queryValue = normalizePhoneNumber(value);
      if (!queryValue) {
          console.error(`Normalized phone number is null for input: ${value}`);
          return res.json({ success: false, message: `Invalid phone number format provided.` });
      }
      queryString = `phone:${queryValue}`;
      break;
    case 'firstName': // Note: Shopify customer search by first_name alone might be less reliable
      queryString = `first_name:${queryValue}`;
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

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

// Helper to format dates human-friendly
const formatDateHuman = (dateString) => {
    if (!dateString) return 'not yet available';
    const date = new Date(dateString);
    // Option 1: Simple format like "May 10th"
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    // Option 2: More advanced, like "yesterday", "tomorrow", "Friday, May 17th"
    // For simplicity, we'll stick to a basic readable format here.
    // Real-world implementation might use a library like 'date-fns' or 'moment'
};

// Helper to estimate arrival date (very basic, can be improved)
const estimateArrivalDate = (shippingDateString) => {
    if (!shippingDateString) return 'not yet available';
    const shippingDate = new Date(shippingDateString);
    // Assuming 5-7 business days for delivery
    const arrivalDate = new Date(shippingDate);
    arrivalDate.setDate(shippingDate.getDate() + 7); // Add 7 days
    return arrivalDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};


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
            // Find the most recent fulfillment
            const latestFulfillment = order.fulfillments[order.fulfillments.length - 1]; // Assuming fulfillments are in chronological order
            latestFulfillmentStatus = latestFulfillment.status;
            shippingDate = latestFulfillment.createdAt; // Shopify fulfillment createdAt is the shipping date

            if (latestFulfillment.trackingInfo && latestFulfillment.trackingInfo.length > 0) {
                const primaryTracking = latestFulfillment.trackingInfo[0];
                hasTracking = true;
                trackingNumber = primaryTracking.number;
                trackingUrl = primaryTracking.url;
                trackingCompany = primaryTracking.company || 'the carrier';
            }
        }
        
        // Humanize dates
        const formattedShippingDate = shippingDate ? formatDateHuman(shippingDate) : 'not yet available';
        const formattedArrivalDate = shippingDate ? estimateArrivalDate(shippingDate) : 'not yet available';


      const formattedOrder = {
        orderId: order.id.split('/').pop(),
        orderName: order.name,
        customerEmail: order.email || 'N/A',
        customerPhone: order.phone || 'N/A',
        lineItemsSummary: lineItemsSummary, // Humanized summary
        fulfillmentStatus: latestFulfillmentStatus,
        hasTracking: hasTracking,
        formattedShippingDate: formattedShippingDate,
        formattedArrivalDate: formattedArrivalDate,
        trackingCompany: trackingCompany,
        // Include raw tracking details, but AI is instructed *not* to read them out unless asked.
        trackingNumber: trackingNumber,
        trackingUrl: trackingUrl,
        // Keep original lineItems for detailed reference if needed, but not for direct read-out
        rawLineItems: lineItems,
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

// --- Endpoint to Get Customer Details --- (No changes needed here for this request)
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

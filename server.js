require('dotenv').config();
const express = require('express');
const cors = require('cors'); 
const { fetchShopifyData, GET_ORDER_DETAILS_QUERY, GET_CUSTOMER_DETAILS_QUERY } = require('./utils/shopifyApi');

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors()); 
app.use(express.json()); 


app.get('/health', (req, res) => {
  res.status(200).send('Middleware is running!');
});


app.post('/get-order-details', async (req, res) => {
  const { queryType, value } = req.body; 

  if (!queryType || !value) {
    return res.status(400).json({ error: "Missing 'queryType' or 'value' in request body." });
  }

  let queryString;
  // Make the query string dynamic based on the queryType
  switch (queryType) {
    case 'name':
      queryString = `name:${value}`;
      break;
    case 'phone':
      queryString = `phone:${value}`;
      break;
    case 'email':
      queryString = `email:${value}`;
      break;
    case 'id': // Shopify GID
      queryString = `id:${value}`;
      break;
    default:
      return res.status(400).json({ error: `Invalid queryType: ${queryType}. Supported: name, phone, email, id.` });
  }

  try {
    const data = await fetchShopifyData(GET_ORDER_DETAILS_QUERY, { queryString });
    const order = data.orders.edges[0]?.node;

    if (order) {
      // Structure the response for Retell AI
      const formattedOrder = {
        orderId: order.id.split('/').pop(), // Extract just the ID number
        orderName: order.name,
        customerEmail: order.email,
        customerPhone: order.phone,
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
    res.status(500).json({ success: false, error: "Failed to fetch order details", details: error.message });
  }
});


app.post('/get-customer-details', async (req, res) => {
  const { queryType, value } = req.body; 
  if (!queryType || !value) {
    return res.status(400).json({ error: "Missing 'queryType' or 'value' in request body." });
  }

  let queryString;
  switch (queryType) {
    case 'email':
      queryString = `email:${value}`;
      break;
    case 'phone':
      queryString = `phone:${value}`;
      break;
    case 'firstName':
      queryString = `first_name:${value}`;
      break;
    default:
      return res.status(400).json({ error: `Invalid queryType: ${queryType}. Supported: email, phone, firstName.` });
  }

  try {
    const data = await fetchShopifyData(GET_CUSTOMER_DETAILS_QUERY, { queryString });
    const customer = data.customers.edges[0]?.node;

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
    res.status(500).json({ success: false, error: "Failed to fetch customer details", details: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Middleware server running on port ${PORT}`);
});
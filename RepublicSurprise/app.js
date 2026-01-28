const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const { Web3 } = require('web3');

// Express app setup
const app = express();
const PORT = process.env.PORT || 3001;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'republic-surprise-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: 'lax'
    }
  })
);

// Hide login button on auth pages
app.use((req, res, next) => {
  const authPaths = ['/', '/login', '/register'];
  res.locals.hideLoginButton = authPaths.includes(req.path);
  next();
});

// Web3 + contract wiring
const providerUrl = process.env.WEB3_PROVIDER_URL || 'http://127.0.0.1:7545';
const web3 = new Web3(providerUrl);
const contractMetaPaths = [
  path.join(__dirname, '..', 'build', 'contracts', 'RepublicSurpriseContract.json'),
  path.join(__dirname, 'build', 'contracts', 'RepublicSurpriseContract.json')
];
const contractMeta = contractMetaPaths.reduce((acc, candidate) => {
  if (acc || !fs.existsSync(candidate)) return acc;
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (_err) {
    return acc;
  }
}, null);
const contractAbi = contractMeta?.abi || [];
let contractAddress = process.env.CONTRACT_ADDRESS || '';
if (!contractAddress && contractMeta?.networks) {
  const firstNetwork = Object.values(contractMeta.networks)[0];
  if (firstNetwork?.address) contractAddress = firstNetwork.address;
}

// Multer storage for uploaded product images
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
  filename: (_req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Global state shared with views
let catalogSyncedAt = null;
let loading = false;
let listOfProducts = [];
let currentUser = null;

// Hydrate per-request user state from the session so API calls (e.g., /api/cart) stay authenticated after redirects
app.use((req, _res, next) => {
  currentUser = req.session?.user || null;
  next();
});
const users = {};
const carts = {};
const products = [
  seedProduct('lolo', 'Lolo the Piggy', 49.9, 8, 'Set of 3', '/images/lolo_the_piggy.png', 'A cheerful trio of piggy pals.'),
  seedProduct('pino', 'Pino JoJo', 37.9, 5, 'Single box', '/images/pino_jojo.png', 'Dreamy pastel friend.'),
  seedProduct('hacibubu', 'Hacibubu', 38.8, 7, 'Limited', '/images/hacibubu.png', 'Limited run surprise.'),
  seedProduct('hinono', 'Hinono', 61.9, 4, 'Collector set', '/images/hinono.png', 'Collector set of mystical figures.'),
  seedProduct('zimama', 'Zimama', 37.9, 3, 'Single box', '/images/zimama.png', 'Forest critter guardian.'),
  seedProduct('sweet-bun', 'Sweet Bun', 20.9, 12, 'Single box', '/images/sweet_bun.png', 'Fluffy friend for cozy nights.')
];
// Stamp initial creation audit entries for seeded/demo products
products.forEach((product) => {
  recordProductAudit(product, 'system', 'Product created', {}, { ...product, auditLog: undefined });
});
const deliveries = [];
const orders = [];
const DELIVERY_STATUS = {
  PENDING: 'pending',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED_PENDING: 'delivered_pending',
  COMPLETED: 'completed'
};
const deliveryProofUpload = multer({ storage: multer.memoryStorage() });

function isDeliveryUser(user) {
  return (user?.role || '').toLowerCase() === 'delivery man';
}

// Home page
app.get('/', (_req, res) => {
  // Using existing home.ejs view (no index.ejs in project)
  res.render('home', {
    user: null, // header.ejs expects a user object; provide null for public home
    errorMessages: [], // flash placeholders expected by home.ejs
    successMessages: []
  });
});

// Registration page (public)
app.get('/register', (_req, res) => {
  res.render('registration', {
    user: null,
    errorMessages: [],
    successMessages: []
  });
});

// Wallet availability check used by registration/login pages
app.get('/register/check-wallet', (req, res) => {
  const wallet = (req.query.walletAddress || '').trim().toLowerCase();
  res.json({ inUse: !!users[wallet] });
});

// Handle registration
app.post('/register', (req, res) => {
  const { walletAddress, name, role, address, contact } = req.body;
  const wallet = (walletAddress || '').trim().toLowerCase();
  if (!wallet) {
    return res.status(400).render('registration', {
      user: null,
      errorMessages: ['Wallet address is required'],
      successMessages: []
    });
  }
  if (users[wallet]) {
    return res.status(400).render('registration', {
      user: null,
      errorMessages: ['This wallet is already registered.'],
      successMessages: []
    });
  }
  // Persist full profile details so admin dashboard and profile pages can display them
  users[wallet] = {
    walletAddress,
    name: name || 'User',
    role: role || 'user',
    address: (address || '').trim(),
    contact: (contact || '').trim(),
    active: true
  };
  currentUser = users[wallet];
  req.session.user = currentUser;
  res.render('login', {
    user: null,
    errorMessages: [],
    successMessages: ['Registration complete. You can log in now.']
  });
});

// Login page (public)
app.get('/login', (_req, res) => {
  res.render('login', {
    user: null,
    errorMessages: [],
    successMessages: []
  });
});

// Handle login by wallet
app.post('/login', (req, res) => {
  const wallet = (req.body.walletAddress || '').trim().toLowerCase();
  const found = users[wallet];
  if (!found) {
    return res.status(401).render('login', {
      user: null,
      errorMessages: ['Wallet not registered. Please register first.'],
      successMessages: []
    });
  }
  currentUser = found;
  req.session.user = currentUser;
  if (currentUser.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  res.redirect('/user/home');
});

app.post('/logout', (_req, res) => {
  currentUser = null;
  if (_req.session) {
    _req.session.destroy(() => res.redirect('/'));
  } else {
    res.redirect('/');
  }
});

// Minimal user home route
app.get('/user/home', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (isDeliveryUser(currentUser)) return res.redirect('/delivery/dashboard');
  res.render('user-home', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

app.get('/shopping', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (isDeliveryUser(currentUser)) return res.redirect('/delivery/dashboard');
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
  const cartCount = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  res.render('user-shopping', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    cart,
    cartCount,
    products
  });
});

app.get('/cart', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (isDeliveryUser(currentUser)) return res.redirect('/delivery/dashboard');
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
  const totals = getCartTotals(cart);
  res.render('cart', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    items: cart,
    cart,
    totals
  });
});

app.get('/api/cart', (_req, res) => {
  if (!currentUser) return res.status(401).json({ success: false, message: 'Login required' });
  if (isDeliveryUser(currentUser)) return res.status(403).json({ success: false, message: 'Not allowed' });
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
  const totals = getCartTotals(cart);
  return res.json({ success: true, items: cart, totals });
});

app.get('/order-tracking', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  res.render('order-tracking', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    orders: getOrdersForUser(currentUser)
  });
});

app.get('/support', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  const userOrders = getOrdersForUser(currentUser);
  res.render('support', {
    user: currentUser,
    orders: userOrders,
    errorMessages: [],
    successMessages: []
  });
});

// Delivery dashboard + status flows
app.get('/delivery/dashboard', (_req, res) => {
  if (!currentUser || currentUser.role !== 'delivery man') return res.redirect('/login');
  const wallet = (currentUser.walletAddress || '').toLowerCase();
  const assignedDeliveries = deliveries.filter(
    (delivery) => (delivery.assignedTo || '').toLowerCase() === wallet
  );
  const pendingDeliveries = deliveries.filter(
    (delivery) => !delivery.assignedTo && delivery.status === DELIVERY_STATUS.PENDING
  );
  res.render('delivery-home', {
    user: currentUser,
    deliveryName: currentUser.name || 'Delivery Partner',
    deliveries: assignedDeliveries,
    pendingDeliveries,
    stats: computeDeliveryStats(assignedDeliveries),
    errorMessages: [],
    successMessages: []
  });
});

app.get('/delivery-history', (_req, res) => {
  if (!currentUser || currentUser.role !== 'delivery man') return res.redirect('/login');
  const wallet = (currentUser.walletAddress || '').toLowerCase();
  const history = deliveries
    .filter((delivery) => (delivery.assignedTo || '').toLowerCase() === wallet)
    .filter((delivery) =>
      [DELIVERY_STATUS.DELIVERED_PENDING, DELIVERY_STATUS.COMPLETED].includes(delivery.status)
    )
    .map((delivery) => ({ ...delivery, status: toDeliveryDisplayStatus(delivery.status) }));
  res.render('delivery-history', {
    user: currentUser,
    deliveryName: currentUser.name || 'Delivery Partner',
    history,
    errorMessages: [],
    successMessages: []
  });
});

app.get('/delivery/order/:id', (req, res) => {
  if (!currentUser) return res.redirect('/login');
  const delivery = deliveries.find((item) => String(item.id) === String(req.params.id));
  if (!delivery) return res.status(404).send('Delivery not found');
  const deliveryView = { ...delivery, status: toDeliveryDisplayStatus(delivery.status) };
  res.render('delivery-order-detail', {
    user: currentUser,
    delivery: deliveryView,
    errorMessages: [],
    successMessages: []
  });
});

app.post('/deliveries/:id/claim', (req, res) => {
  if (!currentUser || currentUser.role !== 'delivery man') return res.redirect('/login');
  const delivery = deliveries.find((item) => String(item.id) === String(req.params.id));
  if (!delivery) return res.status(404).send('Delivery not found');
  delivery.assignedTo = currentUser.walletAddress || '';
  delivery.deliveryName = currentUser.name || 'Delivery Partner';
  if (delivery.status === DELIVERY_STATUS.PENDING) {
    delivery.status = DELIVERY_STATUS.OUT_FOR_DELIVERY;
  }
  res.redirect('/delivery/dashboard');
});

app.post('/deliveries/:id/submit-proof', deliveryProofUpload.single('proofImage'), (req, res) => {
  if (!currentUser || currentUser.role !== 'delivery man') return res.redirect('/login');
  const delivery = deliveries.find((item) => String(item.id) === String(req.params.id));
  if (!delivery) return res.status(404).send('Delivery not found');
  if ((delivery.assignedTo || '') !== (currentUser.walletAddress || '')) {
    return res.status(403).send('Not assigned to this delivery');
  }
  if (req.file) {
    delivery.proofImage = {
      data: req.file.buffer.toString('base64'),
      mimetype: req.file.mimetype
    };
  }
  delivery.remarks = req.body.remarks || delivery.remarks || '';
  delivery.signature = req.body.signature || delivery.signature || '';
  delivery.status = DELIVERY_STATUS.DELIVERED_PENDING;
  const relatedOrder = orders.find(
    (item) => String(item.id) === String(delivery.orderNumber || delivery.id)
  );
  if (relatedOrder) {
    relatedOrder.status = 'Pending Delivery Confirmation';
    relatedOrder.action = 'delivery proof submitted';
    relatedOrder.auditLog = relatedOrder.auditLog || [];
    relatedOrder.auditLog.push({
      action: 'Delivery proof submitted',
      timestamp: new Date().toISOString(),
      function: 'submitProof',
      txHash: '0xDEMO'
    });
  }
  res.redirect('/delivery/dashboard');
});

app.get('/delivery/add-status', (_req, res) => {
  if (!currentUser || (currentUser.role !== 'delivery man' && currentUser.role !== 'admin')) {
    return res.redirect('/login');
  }
  res.render('delivery-add-status', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

app.post('/delivery/add-status', (req, res) => {
  if (!currentUser || (currentUser.role !== 'delivery man' && currentUser.role !== 'admin')) {
    return res.redirect('/login');
  }
  const { orderNumber, customer, status } = req.body || {};
  if (!orderNumber || !customer) {
    return res.status(400).render('delivery-add-status', {
      user: currentUser,
      errorMessages: ['Order number and customer wallet are required.'],
      successMessages: []
    });
  }
  const nextId = deliveries.length ? deliveries.length + 1 : 1;
  deliveries.push({
    id: nextId,
    deliveryId: orderNumber,
    orderNumber,
    customer,
    customerName: customer,
    address: 'N/A',
    contact: 'N/A',
    status: normalizeDeliveryStatus(status)
  });
  res.render('delivery-add-status', {
    user: currentUser,
    errorMessages: [],
    successMessages: ['Delivery record added (demo, not persisted).']
  });
});

app.get('/delivery/update-status', (_req, res) => {
  if (!currentUser || (currentUser.role !== 'delivery man' && currentUser.role !== 'admin')) {
    return res.redirect('/login');
  }
  const deliveriesForView = deliveries.map((delivery) => ({
    ...delivery,
    status: toDeliveryDisplayStatus(delivery.status)
  }));
  res.render('delivery-update-status', {
    user: currentUser,
    deliveries: deliveriesForView,
    errorMessages: [],
    successMessages: []
  });
});

app.post('/delivery/update-status', upload.single('proof'), (req, res) => {
  if (!currentUser || (currentUser.role !== 'delivery man' && currentUser.role !== 'admin')) {
    return res.redirect('/login');
  }
  const { id, status } = req.body || {};
  const delivery = deliveries.find((item) => String(item.id) === String(id));
  if (!delivery) return res.status(404).send('Delivery not found');
  const normalized = normalizeDeliveryStatus(status);
  if (normalized === DELIVERY_STATUS.COMPLETED && currentUser.role !== 'admin') {
    return res.status(403).send('Only admins can complete deliveries');
  }
  delivery.status = normalized;
  if (req.file && normalized === DELIVERY_STATUS.DELIVERED_PENDING) {
    delivery.proofImage = `/images/${req.file.filename}`;
  }
  res.redirect('/delivery/update-status');
});

// Support ticket stub (accept up to 2 attachments)
app.post('/support', upload.array('attachments', 2), (req, res) => {
  if (!currentUser) return res.redirect('/login');
  const { orderId, reason } = req.body || {};
  if (!orderId || !reason) {
    return res.status(400).render('support', {
      user: currentUser,
      errorMessages: ['Order number and reason are required'],
      successMessages: []
    });
  }
  // Ensure the order belongs to the logged-in user before allowing a refund/support request
  const order = orders.find((o) => String(o.id) === String(orderId));
  const wallet = (currentUser.walletAddress || '').toLowerCase();
  if (!order || (order.customer || '').toLowerCase() !== wallet) {
    return res.status(403).render('support', {
      user: currentUser,
      errorMessages: ['You can only request support/refunds for your own orders.'],
      successMessages: []
    });
  }
  // If refund reason is cancellation, restock items
  if (String(reason).toLowerCase() === 'cancelling order') {
    const restockItems = order.items && order.items.length
      ? order.items
      : [{ id: order.product, qty: order.qty }];
    adjustProductStock(restockItems, +1);
  }
  res.render('support', {
    user: currentUser,
    errorMessages: [],
    successMessages: ['Ticket submitted. Our team will reach out soon.']
  });
});

// Cart APIs
app.post('/cart/add', (req, res) => {
  if (!currentUser) {
    return res.status(401).json({ redirect: '/login' });
  }
  if (isDeliveryUser(currentUser)) {
    return res.status(403).json({ error: 'Delivery accounts cannot use the cart.' });
  }
  const { id, name, price, qty } = req.body || {};
  const wallet = currentUser.walletAddress?.toLowerCase();
  if (!wallet || !id) return res.status(400).json({ error: 'Invalid cart payload' });
  const cart = carts[wallet] || [];
  const existing = cart.find((item) => String(item.id) === String(id));
  if (existing) {
    existing.qty = Number(existing.qty || 0) + Number(qty || 1);
  } else {
    cart.push({ id, name, price: Number(price || 0), qty: Number(qty || 1) });
  }
  carts[wallet] = cart;
  const cartCount = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  return respondCart(req, res, { success: true, cartCount });
});

app.post('/cart/update', (req, res) => {
  if (!currentUser) return res.status(401).json({ redirect: '/login' });
  if (isDeliveryUser(currentUser)) {
    return res.status(403).json({ error: 'Delivery accounts cannot use the cart.' });
  }
  const { id, qty } = req.body || {};
  const wallet = currentUser.walletAddress?.toLowerCase();
  const cart = carts[wallet] || [];
  const item = cart.find((p) => String(p.id) === String(id));
  if (item) {
    item.qty = Math.max(0, Number(qty || 0));
    carts[wallet] = cart.filter((p) => Number(p.qty) > 0);
  }
  const cartCount = (carts[wallet] || []).reduce((sum, p) => sum + Number(p.qty || 0), 0);
  const totals = getCartTotals(carts[wallet]);
  return respondCart(req, res, { success: true, cartCount, totals });
});

app.post('/cart/remove/:id', (req, res) => {
  if (!currentUser) return res.status(401).json({ redirect: '/login' });
  if (isDeliveryUser(currentUser)) {
    return res.status(403).json({ error: 'Delivery accounts cannot use the cart.' });
  }
  const wallet = currentUser.walletAddress?.toLowerCase();
  const cart = carts[wallet] || [];
  carts[wallet] = cart.filter((p) => String(p.id) !== String(req.params.id));
  const cartCount = (carts[wallet] || []).reduce((sum, p) => sum + Number(p.qty || 0), 0);
  const totals = getCartTotals(carts[wallet]);
  return respondCart(req, res, { success: true, cartCount, totals });
});

app.post('/cart/clear', (req, res) => {
  if (!currentUser) return res.status(401).json({ redirect: '/login' });
  if (isDeliveryUser(currentUser)) {
    return res.status(403).json({ error: 'Delivery accounts cannot use the cart.' });
  }
  const wallet = currentUser.walletAddress?.toLowerCase();
  carts[wallet] = [];
  return respondCart(req, res, { success: true, cartCount: 0, totals: getCartTotals([]) });
});

// Helpers
function getCartTotals(cart = []) {
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const shipping = subtotal > 0 ? 5 : 0;
  const total = subtotal + shipping;
  return { subtotal, shipping, total };
}

function normalizeDeliveryStatus(status = '') {
  const value = String(status).trim().toLowerCase();
  if (value === 'pending') return DELIVERY_STATUS.PENDING;
  if (value === 'pending confirmation') return DELIVERY_STATUS.DELIVERED_PENDING;
  if (value === 'out for delivery' || value === 'out_for_delivery') return DELIVERY_STATUS.OUT_FOR_DELIVERY;
  if (value === 'delivered pending' || value === 'delivered_pending') return DELIVERY_STATUS.DELIVERED_PENDING;
  if (value === 'completed') return DELIVERY_STATUS.COMPLETED;
  return value.replace(/\s+/g, '_');
}

function toDeliveryDisplayStatus(status = '') {
  switch (status) {
    case DELIVERY_STATUS.OUT_FOR_DELIVERY:
      return 'Out for Delivery';
    case DELIVERY_STATUS.DELIVERED_PENDING:
      return 'Pending confirmation';
    case DELIVERY_STATUS.COMPLETED:
      return 'Completed';
    case DELIVERY_STATUS.PENDING:
    default:
      return 'Pending';
  }
}

function computeDeliveryStats(list = []) {
  const stats = { assigned: 0, pending: 0, delivered_pending: 0 };
  list.forEach((delivery) => {
    stats.assigned += 1;
    if (delivery.status === DELIVERY_STATUS.PENDING) stats.pending += 1;
    if (delivery.status === DELIVERY_STATUS.DELIVERED_PENDING) stats.delivered_pending += 1;
  });
  return stats;
}

function respondCart(req, res, payload) {
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    return res.redirect('/cart');
  }
  return res.json(payload);
}

function getOrdersForUser(user) {
  const wallet = (user?.walletAddress || '').toLowerCase();
  return orders.filter((order) => (order.customer || '').toLowerCase() === wallet);
}

function getDriversMap() {
  return Object.values(users).reduce((acc, user) => {
    if ((user.role || '').toLowerCase() === 'delivery man') {
      acc[(user.walletAddress || '').toLowerCase()] = user;
    }
    return acc;
  }, {});
}

function ensureDemoCart(wallet) {
  const cart = carts[wallet] || [];
  if (cart.length) return cart;
  const picks = products.slice(0, 2);
  const seeded = picks.map((item, idx) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price || 0),
    qty: idx === 0 ? 2 : 1
  }));
  carts[wallet] = seeded;
  return seeded;
}

function createOrderFromCart(user, cart) {
  const nextId = orders.length + 1;
  const orderId = `ORD-${String(nextId).padStart(4, '0')}`;
  const primary = cart[0] || {};
  const qtyTotal = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const priceTotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const order = {
    id: orderId,
    product: cart.length > 1 ? `${primary.name || 'Item'} + ${cart.length - 1} more` : primary.name || 'Item',
    customer: (user.walletAddress || '').toLowerCase(),
    customerName: user.name || 'Customer',
    address: user.address || 'N/A',
    contact: user.contact || 'N/A',
    price: priceTotal,
    qty: qtyTotal,
    status: 'Pending',
    action: 'order creation',
    auditLog: [
      {
        action: 'Order created',
        timestamp: new Date().toISOString(),
        function: 'createOrder',
        txHash: '0xDEMO'
      }
    ]
  };
  orders.push(order);
  return order;
}

function createDemoOrderForDelivery(deliveryUser) {
  const nextId = orders.length + 1;
  const orderId = `ORD-${String(nextId).padStart(4, '0')}`;
  const product = products[0] || { name: 'Demo Item', price: 10 };
  const order = {
    id: orderId,
    product: product.name || 'Demo Item',
    customer: (deliveryUser.walletAddress || '').toLowerCase() || '0xdemo',
    customerName: 'Demo Customer',
    address: 'Demo Address',
    contact: 'Demo Contact',
    price: Number(product.price || 0),
    qty: 1,
    status: 'Pending',
    action: 'demo delivery seed',
    auditLog: [
      {
        action: 'Demo order created',
        timestamp: new Date().toISOString(),
        function: 'createDemoOrderForDelivery',
        txHash: '0xDEMO'
      }
    ]
  };
  orders.push(order);
  return order;
}

function createDemoDelivery(order, user) {
  const nextId = deliveries.length ? deliveries.length + 1 : 1;
  const assignedTo =
    (user.role || '').toLowerCase() === 'delivery man' ? user.walletAddress || '' : '';
  const status = assignedTo ? DELIVERY_STATUS.OUT_FOR_DELIVERY : DELIVERY_STATUS.PENDING;
  deliveries.push({
    id: nextId,
    deliveryId: `DEL-${String(nextId).padStart(3, '0')}`,
    orderNumber: order.id,
    customer: order.customer,
    customerName: order.customerName,
    address: order.address || 'N/A',
    contact: order.contact || 'N/A',
    status,
    proofImage: null,
    assignedTo
  });
}

function buildTrackingPayload(order, cart) {
  const placedAt = new Date().toISOString();
  return {
    orderId: order.id,
    invoiceId: `INV-${order.id}`,
    placedAt,
    items: cart.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price
    })),
    statusHistory: [
      { label: 'Order placed', time: placedAt },
      { label: 'Out for delivery', time: placedAt },
      { label: 'Pending delivery confirmation', time: placedAt }
    ],
    sgdRate: 1
  };
}

function recordProductAudit(product, actor = 'admin', action = 'Product updated', before = {}, after = {}) {
  if (!product) return;
  if (!Array.isArray(product.auditLog)) product.auditLog = [];
  const buildSnapshot = (source) => {
    // Clone shallowly and drop auditLog to avoid circular refs during JSON stringify in views
    const { auditLog, ...rest } = source || {};
    return { ...rest };
  };
  const fields = [
    'productName',
    'productDescription',
    'enableIndividual',
    'enableSet',
    'individualPrice',
    'individualStock',
    'setPrice',
    'setStock',
    'setBoxes',
    'price',
    'stock',
    'badge',
    'image',
    'mainImageIndex',
    'active'
  ];
  const changes = fields
    .map((field) => ({
      field,
      from: before[field],
      to: after[field]
    }))
    .filter((entry) => entry.from !== entry.to);

  product.auditLog.push({
    action,
    timestamp: new Date().toISOString(),
    actor,
    txHash: '0xLOCAL',
    changes,
    snapshot: buildSnapshot(after)
  });
}

// Create order records coming from the payment page so admins can see them
app.post('/create-order', (req, res) => {
  if (!currentUser) return res.status(401).json({ success: false, message: 'Login required' });

  const {
    orderId,
    customerWallet,
    customerName,
    contact,
    address,
    product,
    price,
    qty,
    status,
    items = []
  } = req.body || {};

  const shippingAddress = (address || currentUser.address || '').trim();
  const contactNumber = (contact || currentUser.contact || '').trim();
  if (!shippingAddress) {
    return res.status(400).json({ success: false, message: 'Address is required' });
  }
  if (!contactNumber) {
    return res.status(400).json({ success: false, message: 'Contact is required' });
  }

  const id = orderId || `ORD-${String(orders.length + 1).padStart(4, '0')}`;
  const existing = orders.find((o) => String(o.id) === String(id));

  const payload = {
    id,
    product: product || 'Mystery Items',
    customer: (customerWallet || currentUser.walletAddress || '').toLowerCase(),
    customerName: customerName || currentUser.name || 'Customer',
    address: shippingAddress,
    contact: contactNumber,
    price: Number(price || 0),
    qty: Number(qty || 1),
    items: Array.isArray(items) ? items : [],
    status: status || 'Pending Delivery Confirmation',
    action: 'order creation',
    auditLog: [
      ...(existing?.auditLog || []),
      {
        action: 'Order created',
        timestamp: new Date().toISOString(),
        function: 'create-order',
        txHash: '0xLOCAL'
      }
    ]
  };

  if (existing) Object.assign(existing, payload);
  else orders.push(payload);

  // Reduce product stock based on ordered items
  const stockItems = payload.items && payload.items.length
    ? payload.items
    : [{ id: product, qty: qty }];
  adjustProductStock(stockItems, -1);

  return res.json({ success: true, orderId: id });
});

// Create delivery record (used by payment flow to notify delivery team)
app.post('/create-delivery', (req, res) => {
  if (!currentUser) return res.status(401).json({ success: false, message: 'Login required' });

  const { orderId, customerWallet, customerName, address, contact } = req.body || {};
  const shippingAddress = (address || currentUser.address || '').trim();
  const contactNumber = (contact || currentUser.contact || '').trim();
  if (!shippingAddress) {
    return res.status(400).json({ success: false, message: 'Address is required' });
  }
  if (!contactNumber) {
    return res.status(400).json({ success: false, message: 'Contact is required' });
  }
  const id = deliveries.length ? deliveries.length + 1 : 1;
  const deliveryId = `DEL-${String(id).padStart(3, '0')}`;

  const record = {
    id,
    deliveryId,
    orderNumber: orderId || `ORD-${String(id).padStart(4, '0')}`,
    customer: (customerWallet || currentUser.walletAddress || '').toLowerCase(),
    customerName: customerName || currentUser.name || 'Customer',
    address: shippingAddress,
    contact: contactNumber,
    status: DELIVERY_STATUS.PENDING,
    proofImage: null,
    assignedTo: ''
  };

  deliveries.push(record);
  return res.json({ success: true, deliveryId });
});

// Lightweight order status endpoint for tracking page
app.get('/order-status/:id', (req, res) => {
  if (!currentUser) return res.status(401).json({ success: false, message: 'Login required' });
  const id = req.params.id;
  const delivery = deliveries.find((d) => String(d.orderNumber || d.id) === String(id));
  if (!delivery) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  // Ensure the requesting user owns the order
  const requester = (currentUser.walletAddress || '').toLowerCase();
  if ((delivery.customer || '').toLowerCase() !== requester) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  const statusMap = {
    [DELIVERY_STATUS.PENDING]: 'Pending',
    [DELIVERY_STATUS.OUT_FOR_DELIVERY]: 'Out for delivery',
    [DELIVERY_STATUS.DELIVERED_PENDING]: 'Pending delivery confirmation',
    [DELIVERY_STATUS.COMPLETED]: 'Completed'
  };
  const statusLabel = statusMap[delivery.status] || 'Pending';
  return res.json({
    success: true,
    orderId: delivery.orderNumber,
    status: delivery.status,
    statusLabel,
    updatedAt: delivery.updatedAt || delivery.timestamp || ''
  });
});

function seedProduct(
  id,
  name,
  price,
  stock,
  badge,
  image,
  description,
  enableIndividual = true,
  enableSet = false,
  setPrice = 0,
  setStock = 0,
  setBoxes = 0
) {
  return {
    id,
    name,
    productName: name,
    productDescription: description,
    price,
    badge,
    image,
    enableIndividual,
    individualPrice: price,
    individualStock: stock,
    enableSet,
    setPrice,
    setStock,
    setBoxes,
    stock,
    active: true,
    auditLog: []
  };
}

// Payment page (stub)
app.get('/payment', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (isDeliveryUser(currentUser)) return res.redirect('/delivery/dashboard');
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
  if (!cart.length) {
    return res.render('cart', {
      user: currentUser,
      errorMessages: ['Your cart is empty. Add items before proceeding to payment.'],
      successMessages: [],
      items: cart,
      cart,
      totals: getCartTotals(cart)
    });
  }
  const totals = getCartTotals(cart);
  res.render('payment', {
    user: currentUser,
    cart,
    totals,
    errorMessages: [],
    successMessages: []
  });
});

// Invoice page stub
app.get('/invoice', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (isDeliveryUser(currentUser)) return res.redirect('/delivery/dashboard');
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
  const totals = getCartTotals(cart);
  res.render('invoice', {
    user: currentUser,
    cart,
    totals,
    errorMessages: [],
    successMessages: []
  });
});

// Admin dashboard stub
app.get('/admin/dashboard', (_req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  res.render('admin-home', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

app.get('/admin/inventory', (_req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  res.render('admin-inventory', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    products
  });
});

app.get('/admin/add-product', (_req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  res.render('admin-add-product', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

app.post('/admin/add-product', upload.any(), (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const {
    productName,
    productDescription,
    priceWei,
    individualPrice,
    individualStock,
    setPrice,
    setStock,
    enableSet,
    enableIndividual,
    setBoxes
  } = req.body || {};
  const nextId = products.length ? products.length + 1 : 1;
  const enableIndividualBool = enableIndividual === 'on' || enableIndividual === true || enableIndividual === 'true';
  const enableSetBool = enableSet === 'on' || enableSet === true || enableSet === 'true';
  const indivPriceNum = Number(individualPrice || 0) || 0;
  const indivStockNum = Number(individualStock || 0) || 0;
  const setPriceNum = Number(setPrice || 0) || 0;
  const setStockNum = Number(setStock || 0) || 0;
  const setBoxesNum = Number(setBoxes || 0) || 0;
  const badge =
    enableSetBool && enableIndividualBool ? 'Single & Set' : enableSetBool ? 'Set' : 'Single box';

  // Use uploaded image (first file) if provided; fall back to default
  const firstFile = Array.isArray(req.files) && req.files.length ? req.files[0] : null;
  const imagePath = firstFile ? `/images/${firstFile.filename || firstFile.originalname}` : '/images/lolo_the_piggy.png';

  const newProduct = seedProduct(
    `prod-${nextId}`,
    productName || 'New Product',
    indivPriceNum || Number(priceWei || 0) || setPriceNum,
    indivStockNum || setStockNum,
    badge,
    imagePath,
    productDescription || '',
    enableIndividualBool,
    enableSetBool,
    setPriceNum,
    setStockNum,
    setBoxesNum
  );
  if (firstFile) {
    newProduct.images = [imagePath];
    newProduct.mainImageIndex = '1';
  }

  products.push(newProduct);
  recordProductAudit(
    newProduct,
    currentUser?.walletAddress || 'admin',
    'Product created',
    {},
    { ...newProduct, auditLog: undefined }
  );
  res.render('admin-add-product', {
    user: currentUser,
    errorMessages: [],
    successMessages: ['Product added (demo, not persisted)']
  });
});

app.get('/admin/orders', (_req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  res.render('admin-orders', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    orders: orders.slice().reverse(),
    deliveries,
    drivers: getDriversMap()
  });
});

app.get('/admin/orders/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const order = orders.find((item) => String(item.id) === String(req.params.id));
  if (!order) return res.status(404).send('Order not found');
  res.render('admin-order-detail', {
    user: currentUser,
    order,
    errorMessages: [],
    successMessages: []
  });
});

app.get('/admin/orders/check/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const order = orders.find((item) => String(item.id) === String(req.params.id));
  if (!order) return res.status(404).send('Order not found');
  const delivery = deliveries.find(
    (item) => String(item.orderNumber || item.id) === String(order.id)
  );
  res.render('admin-order-completion-check', {
    user: currentUser,
    order,
    delivery,
    errorMessages: [],
    successMessages: []
  });
});

app.post('/admin/orders/confirm/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const order = orders.find((item) => String(item.id) === String(req.params.id));
  if (!order) return res.status(404).send('Order not found');
  order.status = 'Completed';
  order.action = 'delivery completion';
  order.auditLog = order.auditLog || [];
  order.auditLog.push({
    action: 'Order completed',
    timestamp: new Date().toISOString(),
    function: 'confirmDelivery',
    txHash: '0xDEMO'
  });
  const delivery = deliveries.find(
    (item) => String(item.orderNumber || item.id) === String(order.id)
  );
  if (delivery) delivery.status = DELIVERY_STATUS.COMPLETED;
  res.redirect('/admin/orders');
});

app.get('/admin/delivery/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const delivery = deliveries.find(
    (item) => String(item.deliveryId || item.id) === String(req.params.id)
  );
  if (!delivery) return res.status(404).send('Delivery not found');
  const deliveryView = { ...delivery, status: toDeliveryDisplayStatus(delivery.status) };
  res.render('delivery-order-detail', {
    user: currentUser,
    delivery: deliveryView,
    errorMessages: [],
    successMessages: []
  });
});

app.get('/demo/seed-order', (req, res) => {
  if (!currentUser) return res.redirect('/login');
  const wallet = (currentUser.walletAddress || '').toLowerCase();
  const cart = ensureDemoCart(wallet);
  const order = createOrderFromCart(currentUser, cart);
  createDemoDelivery(order, currentUser);

  if (currentUser.role === 'admin') return res.redirect('/admin/orders');
  if (currentUser.role === 'delivery man') return res.redirect('/delivery/dashboard');

  const trackingPayload = buildTrackingPayload(order, cart);
  const trackingJson = JSON.stringify(trackingPayload);
  res.set('Content-Type', 'text/html');
  return res.send(`<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Seeding Demo Order</title></head>
  <body>
    <script>
      (function() {
        var TRACKING_KEY = 'ORDER_TRACKING_DATA';
        var incoming = ${trackingJson};
        var existing = [];
        try { existing = JSON.parse(sessionStorage.getItem(TRACKING_KEY) || '[]'); } catch (e) { existing = []; }
        if (!Array.isArray(existing)) existing = [];
        existing.push(incoming);
        sessionStorage.setItem(TRACKING_KEY, JSON.stringify(existing));
        window.location.href = '/order-tracking?orderId=' + encodeURIComponent(incoming.orderId || '');
      })();
    </script>
  </body>
</html>`);
});

app.get('/delivery/demo-seed', (_req, res) => {
  if (!currentUser || currentUser.role !== 'delivery man') return res.redirect('/login');
  const order = createDemoOrderForDelivery(currentUser);
  createDemoDelivery(order, currentUser);
  res.redirect('/delivery/dashboard');
});

app.get('/admin/users', (_req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  res.render('admin-users', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    users: Object.values(users)
  });
});

// Admin user audit history (placeholder until contract wiring)
app.get('/admin/users/history/:wallet', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const wallet = (req.params.wallet || '').toLowerCase();
  const target = users[wallet];
  if (!target) return res.status(404).send('User not found');

  // TODO: After deployment, replace [] with on-chain history for this wallet.
  const history = [];

  res.render('admin-user-history', {
    user: currentUser,
    targetUser: target,
    history,
    errorMessages: [],
    successMessages: []
  });
});

app.post('/admin/reactivate-user/:wallet', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const wallet = (req.params.wallet || '').toLowerCase();
  const target = users[wallet];
  if (target) target.active = true;
  res.redirect('/admin/users');
});

app.get('/admin/customer-service', (_req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  res.render('admin-customer-service', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    tickets: []
  });
});

// Admin product deactivate/reactivate

app.post('/admin/deactivate-product/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.params.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (product) {
    const before = { ...product };
    product.active = false;
    listOfProducts = [...products];
    recordProductAudit(product, currentUser?.walletAddress || 'admin', 'Product deactivated', before, { ...product });
  }
  res.redirect('/admin/inventory');
});

app.post('/admin/reactivate-product/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.params.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (product) {
    const before = { ...product };
    product.active = true;
    listOfProducts = [...products];
    recordProductAudit(product, currentUser?.walletAddress || 'admin', 'Product reactivated', before, { ...product });
  }
  res.redirect('/admin/inventory');
});

// Admin product detail view used by inventory links
app.get('/admin/product/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.params.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (!product) return res.status(404).send('Product not found');
  res.render('admin-product-history', {
    user: currentUser,
    product,
    history: product.auditLog || [],
    errorMessages: [],
    successMessages: []
  });
});

// Product detail
app.get('/product', (req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (isDeliveryUser(currentUser)) return res.redirect('/delivery/dashboard');
  const id = req.query.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (!product) return res.status(404).send('Product not found');
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
  const cartCount = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  res.render('user-product', {
    user: currentUser,
    product,
    cartCount,
    catalog: products.filter((p) => p.id !== product.id),
    errorMessages: [],
    successMessages: []
  });
});

// Provide contract config for the frontend Web3 instance
app.get('/contract-config', (_req, res) => {
  res.json({
    providerUrl,
    contractAddress,
    abi: contractAbi
  });
});

// Receive product data fetched from smart contract via frontend Web3
app.post('/web3/products', (req, res) => {
  loading = true;
  try {
    const { products: contractProducts = [], contractAddress: clientAddress, syncedAt } = req.body || {};
    if (clientAddress && !contractAddress) contractAddress = clientAddress;
    if (!Array.isArray(contractProducts)) {
      return res.status(400).json({ success: false, message: 'products must be an array' });
    }

    products.length = 0;
    contractProducts.forEach((p, idx) => {
      products.push(normalizeProductPayload(p, idx));
    });

    listOfProducts = [...products];
    catalogSyncedAt = syncedAt || new Date().toISOString();
    loading = false;

    return res.json({ success: true, count: products.length, syncedAt: catalogSyncedAt });
  } catch (error) {
    loading = false;
    console.error('Error syncing products from contract:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Expose loading flag for polling from frontend
app.get('/loading-status', (_req, res) => {
  res.json({ loading, syncedAt: catalogSyncedAt });
});

// Helper to normalize contract payload into UI-friendly product shape
function normalizeProductPayload(raw, idx = 0) {
  const enableIndividual = raw.enableIndividual !== false;
  const enableSet = !!raw.enableSet;
  const badge = raw.badge || (enableSet && enableIndividual ? 'Single & Set' : enableSet ? 'Set' : 'Single box');

  const individualPrice =
    Number(raw.individualPrice ?? raw.individualPriceWei ?? raw.price ?? raw.priceWei ?? 0) || 0;
  const individualStock = Number(raw.individualStock ?? raw.stock ?? 0) || 0;
  const setPrice = Number(raw.setPrice ?? raw.setPriceWei ?? 0) || 0;
  const setStock = Number(raw.setStock ?? 0) || 0;
  const setBoxes = Number(raw.setBoxes ?? 0) || 0;

  return seedProduct(
    raw.id || raw.productId || `prod-${idx + 1}`,
    raw.name || raw.productName || `Product ${idx + 1}`,
    individualPrice || setPrice,
    individualStock || setStock,
    badge,
    raw.image || '/images/lolo_the_piggy.png',
    raw.description || raw.productDescription || '',
    enableIndividual,
    enableSet,
    setPrice,
    setStock,
    setBoxes
  );
}

function adjustProductStock(items = [], deltaSign = -1) {
  if (!Array.isArray(items)) return;
  items.forEach((it) => {
    const pid = it.id || it.productId || it.product || it.name;
    const qty = Number(it.qty || it.quantity || 1) || 1;
    const product = products.find((p) => String(p.id) === String(pid));
    if (!product) return;
    const delta = deltaSign * qty;
    if (product.enableIndividual) {
      product.individualStock = Math.max(0, Number(product.individualStock || 0) + delta);
      product.stock = product.individualStock;
    } else {
      product.stock = Math.max(0, Number(product.stock || 0) + delta);
    }
    if (product.enableSet) {
      product.setStock = Math.max(0, Number(product.setStock || 0) + delta);
    }
  });
  listOfProducts = [...products];
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

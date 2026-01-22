const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');

const app = express();
const PORT = 3000;

const users = {}; // simple in-memory user store for demo
const products = [];
let lastProductId = null;
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 3 } });

const productFields = [
  'productName',
  'productDescription',
  'mainImageIndex',
  'enableIndividual',
  'enableSet',
  'individualPrice',
  'individualStock',
  'setBoxes',
  'setPrice',
  'setStock',
  'active'
];

const pickProductFields = (source) =>
  productFields.reduce((acc, key) => {
    acc[key] = source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : '';
    return acc;
  }, {});

const buildAuditEntry = (action, actor, before, after) => {
  const beforeSnapshot = before ? pickProductFields(before) : null;
  const afterSnapshot = after ? pickProductFields(after) : null;
  const changes = [];

  if (beforeSnapshot && afterSnapshot) {
    productFields.forEach((key) => {
      if (beforeSnapshot[key] !== afterSnapshot[key]) {
        changes.push({ field: key, from: beforeSnapshot[key], to: afterSnapshot[key] });
      }
    });
  }

  return {
    action,
    actor: actor || 'system',
    timestamp: new Date().toISOString(),
    changes,
    snapshot: afterSnapshot || beforeSnapshot
  };
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'replace-with-env-secret',
    resave: false,
    saveUninitialized: false
  })
);
app.use(flash());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.errorMessages = req.flash('error');
  res.locals.successMessages = req.flash('success');
  res.locals.user = req.session.user || null;
  const cart = req.session.cart || [];
  res.locals.cartCount = cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  next();
});

const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    req.flash('error', 'please log in to view this page');
    return res.redirect('/login');
  }
  next();
};

const requireUserRole = (req, res, next) => {
  if (!req.session.user) {
    req.flash('error', 'Please log in to add to cart.');
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'user') {
    req.flash('error', 'Only customer accounts can add to cart.');
    return res.redirect('/login');
  }
  next();
};

const allowRoles = (roles) => (req, res, next) => {
  if (!req.session.user) {
    req.flash('error', 'please log in to view this page');
    return res.redirect('/login');
  }
  if (!roles.includes(req.session.user.role)) {
    req.flash('error', 'Access denied for your role.');
    return res.redirect('/');
  }
  next();
};

app.get('/', (_req, res) => {
  res.render('home');
});

app.get('/home', (_req, res) => {
  res.redirect('/');
});

app.get('/user/home', allowRoles(['user']), (req, res) => {
  res.render('user-home');
});

app.get('/register', (_req, res) => {
  res.render('registration');
});

app.post('/register', (req, res) => {
  const { name, email, password, address, contact, role } = req.body;
  const errors = [];
  if (!name) errors.push('Name is required.');
  if (!email) errors.push('Email is required.');
  if (!password) errors.push('Password is required.');
  if (password && password.length < 6) errors.push('Password must be at least 6 characters.');
  if (!address) errors.push('Address is required.');
  if (!contact) errors.push('Contact number is required.');
  if (!role) errors.push('Role is required.');
  const allowedRoles = ['user', 'admin', 'delivery man'];
  if (role && !allowedRoles.includes(role)) errors.push('Invalid role selected.');

  if (errors.length) {
    errors.forEach((msg) => req.flash('error', msg));
    return res.redirect('/register');
  }

  users[email] = { name, email, password, address, contact, role };
  req.session.user = { email, role };
  req.flash('success', 'Registration successful.');
  if (role === 'admin') return res.redirect('/admin/dashboard');
  if (role === 'delivery man') return res.redirect('/delivery/dashboard');
  return res.redirect('/user/home');
});

app.get('/login', (_req, res) => {
  res.render('login');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/login');
  }

  const user = users[email];
  if (!user || user.password !== password) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }

  req.session.user = { email: user.email, role: user.role };
  req.flash('success', 'Logged in successfully.');
  if (user.role === 'admin') return res.redirect('/admin/dashboard');
  if (user.role === 'delivery man') return res.redirect('/delivery/dashboard');
  return res.redirect('/user/home');
});

app.get('/admin/dashboard', allowRoles(['admin']), (req, res) => {
  res.render('admin-home');
});
app.get('/admin/orders', allowRoles(['admin']), (_req, res) => {
  res.render('admin-orders', { orders });
});

app.get('/admin/orders/:id', allowRoles(['admin']), (req, res) => {
  const order = orders.find((o) => o.id === req.params.id) || null;
  if (!order) {
    req.flash('error', 'Order not found.');
    return res.redirect('/admin/orders');
  }
  res.render('admin-order-detail', { order });
});

app.get('/admin/orders/check/:id', allowRoles(['admin']), (req, res) => {
  const order = orders.find((o) => o.id === req.params.id) || null;
  if (!order) {
    req.flash('error', 'Order not found.');
    return res.redirect('/admin/orders');
  }
  const delivery = deliveries.find((d) => d.id === order.id) || null;
  res.render('admin-order-completion-check', { order, delivery });
});

app.post('/admin/orders/confirm/:id', allowRoles(['admin']), (req, res) => {
  const target = orders.find((o) => o.id === req.params.id);
  if (target) {
    if (target.status === 'Pending Delivery Confirmation') {
      const linkedDelivery = deliveries.find((d) => d.id === target.id);
      if (!linkedDelivery || !linkedDelivery.proofImage) {
        req.flash('error', 'Proof image missing. Please review submission before confirming.');
        return res.redirect(`/admin/orders/check/${target.id}`);
      }
      target.status = 'Completed';
      req.flash('success', `Order ${target.id} marked completed.`);
      if (linkedDelivery) linkedDelivery.status = 'Completed';
    } else {
      req.flash('error', 'This order cannot be confirmed in its current status.');
    }
  } else {
    req.flash('error', 'Order not found.');
  }
  res.redirect('/admin/orders');
});

app.get('/admin/users', allowRoles(['admin']), (_req, res) => {
  const list = Object.values(users).map((u, index) => ({
    idx: index + 1,
    name: u.name,
    email: u.email,
    role: u.role,
    address: u.address,
    contact: u.contact
  }));
  res.render('admin-users', { users: list });
});

app.get('/admin/customer-service', allowRoles(['admin']), (_req, res) => {
  res.render('admin-customer-service', { tickets: refundTickets });
});

app.get('/admin/customer-service/:id', allowRoles(['admin']), (req, res) => {
  const ticket = refundTickets.find((t) => t.id === req.params.id) || null;
  if (!ticket) {
    req.flash('error', 'Refund ticket not found.');
    return res.redirect('/admin/customer-service');
  }
  res.render('admin-refund-detail', { ticket });
});

app.post('/admin/customer-service/approve/:id', allowRoles(['admin']), (req, res) => {
  const ticket = refundTickets.find((t) => t.id === req.params.id);
  if (!ticket) {
    req.flash('error', 'Refund ticket not found.');
    return res.redirect('/admin/customer-service');
  }
  ticket.status = 'Approved';
  req.flash('success', `Refund ${ticket.id} approved.`);
  res.redirect('/admin/customer-service');
});
//gul
const deliveries = [
  { id: 'ORD-1001', orderNumber: 'ORD-1001', customer: 'Alice', status: 'Out for Delivery', proofImage: null },
  { id: 'ORD-1002', orderNumber: 'ORD-1002', customer: 'Bob', status: 'Pending', proofImage: null },
  { id: 'ORD-1003', orderNumber: 'ORD-1003', customer: 'Charlie', status: 'Completed', proofImage: null }
];

const orders = [
  { id: 'ORD-1001', product: 'Mystery Box A', customer: 'Alice', price: 49.9, qty: 2, status: 'Pending Delivery Confirmation' },
  { id: 'ORD-1002', product: 'Mystery Box B', customer: 'Bob', price: 59.9, qty: 1, status: 'Pending Delivery Confirmation' },
  { id: 'ORD-1003', product: 'Mystery Box C', customer: 'Charlie', price: 39.9, qty: 3, status: 'Confirmed' }
];

const refundTickets = [
  { id: 'RF-2001', customer: 'Dana', orderId: 'ORD-0999', amount: 29.9, type: 'Partial', status: 'Open' },
  { id: 'RF-2002', customer: 'Eli', orderId: 'ORD-0998', amount: 59.9, type: 'Full', status: 'In Review' }
];



app.get('/delivery/dashboard', allowRoles(['delivery man']), (req, res) => {
  res.render('delivery-home', { deliveries });
});

app.get('/delivery/order/:id', allowRoles(['delivery man']), (req, res) => {
  const delivery = deliveries.find((d) => d.id === req.params.id) || null;
  if (!delivery) {
    req.flash('error', 'Order not found.');
    return res.redirect('/delivery/dashboard');
  }
  res.render('delivery-order-detail', { delivery });
});

const hasApprovedRefund = (orderId) =>
  refundTickets.some((ticket) => ticket.orderId === orderId && ticket.status === 'Approved');


app.get('/admin/add-product', allowRoles(['admin']), (req, res) => {
  res.render('admin-add-product');
});

const buildProductPayload = (body) => ({
  productName: body.productName || '',
  productDescription: body.productDescription || '',
  mainImageIndex: body.mainImageIndex || '1',
  enableIndividual: !!body.enableIndividual,
  enableSet: !!body.enableSet,
  individualPrice: body.individualPrice || '',
  individualStock: body.individualStock || '',
  setBoxes: body.setBoxes || '',
  setPrice: body.setPrice || '',
  setStock: body.setStock || ''
});

const createProduct = (body) => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  createdAt: new Date(),
  ...buildProductPayload(body),
  active: true,
  history: []
});

const validateProductPayload = (body, files) => {
  const errors = [];
  const enableIndividual = !!body.enableIndividual;
  const enableSet = !!body.enableSet;

  if (!files || files.length < 1) errors.push('At least 1 product image is required.');
  if (!body.productName) errors.push('Product name is required.');
  if (!body.productDescription) errors.push('Product description is required.');
  if (!enableIndividual && !enableSet) errors.push('Select at least one blind box purchase type.');

  if (enableIndividual) {
    if (!body.individualPrice) errors.push('Price per box is required.');
    if (!body.individualStock) errors.push('Individual stock quantity is required.');
  }

  if (enableSet) {
    if (!body.setBoxes) errors.push('Number of boxes per set is required.');
    if (!body.setPrice) errors.push('Set price is required.');
    if (!body.setStock) errors.push('Set stock quantity is required.');
  }

  return errors;
};

const getCart = (req) => {
  if (!req.session.cart) req.session.cart = [];
  return req.session.cart;
};

const sanitizeCartItem = (body) => {
  const id = (body.id || '').toString();
  const name = (body.name || '').toString().trim();
  const price = Number(body.price || 0) || 0;
  const qty = Math.max(parseInt(body.qty, 10) || 1, 1);
  return { id, name, price, qty };
};

const calcCartTotals = (cart) => {
  const subtotal = cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
  const shipping = subtotal > 0 ? 6.9 : 0;
  const total = subtotal + shipping;
  return { subtotal, shipping, total };
};

app.post('/admin/add-product', allowRoles(['admin']), upload.array('images', 3), (req, res) => {
  const errors = validateProductPayload(req.body, req.files);
  if (errors.length) {
    errors.forEach((msg) => req.flash('error', msg));
    return res.redirect('/admin/add-product');
  }
  const newProduct = createProduct(req.body);
  newProduct.history.push(buildAuditEntry('created', req.session.user?.email, null, newProduct));
  products.push(newProduct);
  lastProductId = newProduct.id;
  req.flash('success', 'Product saved (demo only).');
  res.redirect('/admin/add-product');
});

app.get('/admin/update-product', allowRoles(['admin']), (req, res) => {
  const targetId = req.query.id || lastProductId;
  const product = products.find((item) => item.id === targetId) || buildProductPayload({});
  res.render('admin-update-product', { product, hasProduct: products.length > 0, productId: targetId || '' });
});

app.post('/admin/update-product', allowRoles(['admin']), upload.array('images', 3), (req, res) => {
  const targetId = req.query.id || lastProductId;
  const errors = validateProductPayload(req.body, req.files);
  if (errors.length) {
    errors.forEach((msg) => req.flash('error', msg));
    return res.redirect(`/admin/update-product${targetId ? `?id=${targetId}` : ''}`);
  }
  const nextPayload = buildProductPayload(req.body);
  const existingIndex = products.findIndex((item) => item.id === targetId);
  if (existingIndex >= 0) {
    const before = products[existingIndex];
    const updated = { ...before, ...nextPayload, active: before.active !== false };
    const entry = buildAuditEntry('updated', req.session.user?.email, before, updated);
    updated.history = [...(before.history || []), entry];
    products[existingIndex] = updated;
    lastProductId = products[existingIndex].id;
  } else {
    const created = createProduct(req.body);
    created.history.push(buildAuditEntry('created', req.session.user?.email, null, created));
    products.push(created);
    lastProductId = created.id;
  }
  req.flash('success', 'Product updated (demo only).');
  res.redirect(`/admin/update-product${targetId ? `?id=${targetId}` : ''}`);
});

app.get('/admin/inventory', allowRoles(['admin']), (req, res) => {
  res.render('admin-inventory', { products });
});

app.get('/admin/product/:id', allowRoles(['admin']), (req, res) => {
  const { id } = req.params;
  const product = products.find((item) => item.id === id) || null;
  if (!product) {
    req.flash('error', 'Product not found.');
    return res.redirect('/admin/inventory');
  }
  const history = product.history || [];
  res.render('admin-product-history', { product, history });
});

app.post('/admin/deactivate-product/:id', allowRoles(['admin']), (req, res) => {
  const { id } = req.params;
  const index = products.findIndex((item) => item.id === id);
  if (index >= 0) {
    const before = products[index];
    if (before.active === false) {
      req.flash('error', 'Product already deactivated.');
      return res.redirect('/admin/inventory');
    }
    const updated = { ...before, active: false };
    const entry = buildAuditEntry('deactivated', req.session.user?.email, before, updated);
    updated.history = [...(before.history || []), entry];
    products[index] = updated;
    if (lastProductId === id) lastProductId = products[index].id;
    req.flash('success', 'Product deactivated (demo only).');
  } else {
    req.flash('error', 'Product not found.');
  }
  res.redirect('/admin/inventory');
});

app.post('/admin/reactivate-product/:id', allowRoles(['admin']), (req, res) => {
  const { id } = req.params;
  const index = products.findIndex((item) => item.id === id);
  if (index >= 0) {
    const before = products[index];
    if (before.active !== false) {
      req.flash('error', 'Product already active.');
      return res.redirect('/admin/inventory');
    }
    const updated = { ...before, active: true };
    const entry = buildAuditEntry('reactivated', req.session.user?.email, before, updated);
    updated.history = [...(before.history || []), entry];
    products[index] = updated;
    if (lastProductId === id) lastProductId = products[index].id;
    req.flash('success', 'Product reactivated (demo only).');
  } else {
    req.flash('error', 'Product not found.');
  }
  res.redirect('/admin/inventory');
});

app.get('/shopping', (_req, res) => {
  res.render('shopping', { products });
});

app.get('/product', (req, res) => {
  const fallbackImages = [
    '/images/lolo_the_piggy.png',
    '/images/pino_jojo.png',
    '/images/hinono.png',
    '/images/zimama.png',
    '/images/sweet_bun.png',
    '/images/hacibubu.png'
  ];

  const demoProducts = [
    { id: 'lolo', productName: 'Lolo the Piggy', productDescription: 'A cheerful trio of piggy.', enableSet: true, enableIndividual: true, setPrice: 49.9, setStock: 8 },
    { id: 'pino', productName: 'Pino JoJo', productDescription: 'Dreamy pastel friend.', enableIndividual: true, individualPrice: 37.9, individualStock: 5 },
    { id: 'hinono', productName: 'Hinono', productDescription: 'Collector set of mystical figures.', enableSet: true, setPrice: 61.9, setStock: 0 },
    { id: 'zimama', productName: 'Zimama', productDescription: 'Forest critter guardian.', enableIndividual: true, individualPrice: 37.9, individualStock: 3 },
    { id: 'sweet-bun', productName: 'Sweet Bun', productDescription: 'Fluffy friend for cozy nights.', enableIndividual: true, individualPrice: 20.9, individualStock: 12 },
    { id: 'hacibubu', productName: 'Hacibubu', productDescription: 'Limited run surprise.', enableIndividual: true, individualPrice: 38.8, individualStock: 7 }
  ];

  const normalizeProducts = (list, offset = 0) =>
    list.map((item, index) => {
      const price = Number(item.individualPrice || item.setPrice || 0) || 0;
      const stock = Number(item.individualStock || item.setStock || 0) || 0;
      const badge =
        item.enableSet && item.enableIndividual
          ? 'Single & Set'
          : item.enableSet
          ? 'Set'
          : 'Single box';
      const imageIndex = (offset + index) % fallbackImages.length;
      return {
        id: item.id || `product-${index}`,
        name: item.productName || 'Mystery figure',
        description: item.productDescription || 'Blind box collectible',
        price,
        stock,
        badge,
        image: item.image || fallbackImages[imageIndex]
      };
    });

  const serverCatalog = normalizeProducts(products, 0);
  const demoCatalog = normalizeProducts(demoProducts, products.length);
  const catalog = serverCatalog.length ? [...serverCatalog, ...demoCatalog] : demoCatalog;
  const targetId = req.query.id;
  const selected = targetId ? catalog.find((item) => item.id === targetId) : catalog[0] || null;

  res.render('product', { product: selected || null, catalog });
});

app.get('/cart', allowRoles(['user']), (req, res) => {
  const cart = getCart(req);
  const totals = calcCartTotals(cart);
  res.render('cart', { cart, totals });
});

// Payment and invoice views (frontend-only handlers)
app.get('/payment', (req, res) => {
  res.render('payment');
});

app.get('/invoice', (req, res) => {
  res.render('invoice');
});

app.get('/order-tracking', allowRoles(['user']), (req, res) => {
  res.render('order-tracking');
});

app.post('/cart/add', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ redirect: '/login', message: 'Please log in to add to cart.' });
    }
    req.flash('error', 'Please log in to add to cart.');
    return res.redirect('/login');
  }
  const cart = getCart(req);
  const item = sanitizeCartItem(req.body);
  if (!item.id || !item.name || !Number.isFinite(item.price)) {
    return res.status(400).json({ error: 'Invalid cart item.' });
  }
  const existing = cart.find((entry) => entry.id === item.id);
  if (existing) existing.qty += item.qty;
  else cart.push(item);
  req.session.cart = cart;
  const cartCount = cart.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0);

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ cartCount });
  }
  req.flash('success', 'Item added to cart.');
  return res.redirect('/cart');
});

app.post('/cart/update', allowRoles(['user']), (req, res) => {
  const cart = getCart(req);
  const id = (req.body.id || '').toString();
  const qty = Math.max(parseInt(req.body.qty, 10) || 0, 0);
  const index = cart.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    if (qty === 0) cart.splice(index, 1);
    else cart[index].qty = qty;
    req.session.cart = cart;
  }
  res.redirect('/cart');
});

app.post('/cart/remove/:id', allowRoles(['user']), (req, res) => {
  const cart = getCart(req);
  const id = req.params.id;
  const index = cart.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    cart.splice(index, 1);
    req.session.cart = cart;
  }
  res.redirect('/cart');
});

const protectedRoutes = [
  { path: '/mainpage', roles: ['user'], title: 'Main Page' },
  { path: '/order-tracking', roles: ['user'], title: 'Order Tracking' }
];

// GET route for Add Delivery Status
app.get('/delivery/add-status', allowRoles(['delivery man']), (req, res) => {
  res.render('delivery-add-status'); // render your new EJS page for adding deliveries
});

// POST route for Add Delivery Status
app.post('/delivery/add-status', allowRoles(['delivery man']), (req, res) => {
  const { customer, orderNumber, status } = req.body;
  if (!orderNumber) {
    req.flash('error', 'Order number is required.');
    return res.redirect('/delivery/add-status');
  }
  deliveries.push({
    id: orderNumber,
    orderNumber,
    customer: customer || 'Unknown',
    status: status || 'Pending',
    proofImage: null
  });
  req.flash('success', 'Delivery added successfully.');
  res.redirect('/delivery/dashboard');
});

// GET route for Update Delivery Status
app.get('/delivery/update-status', allowRoles(['delivery man']), (req, res) => {
  res.render('delivery-update-status', { deliveries }); // pass deliveries to the EJS
});

// POST route for Update Delivery Status
app.post('/delivery/update-status', allowRoles(['delivery man']), upload.single('proof'), (req, res) => {
  const { id, status } = req.body;
  const delivery = deliveries.find((d) => d.id === id);
  if (!delivery) {
    req.flash('error', 'Delivery not found.');
    return res.redirect('/delivery/dashboard');
  }

  if (delivery.status === 'Completed' && !hasApprovedRefund(id)) {
    req.flash('error', 'Completed orders cannot be changed unless a refund was approved.');
    return res.redirect('/delivery/dashboard');
  }

  // If delivery man tries to mark as completed, require proof and move to pending confirmation.
  if (status === 'Completed') {
    if (!req.file || !['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
      req.flash('error', 'Please upload a .jpg or .png proof image to mark delivery.');
      return res.redirect('/delivery/dashboard');
    }
    const proofImage = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    delivery.proofImage = proofImage;
    delivery.status = 'Pending confirmation';
    const linkedOrder = orders.find((o) => o.id === delivery.id);
    if (linkedOrder) linkedOrder.status = 'Pending Delivery Confirmation';
    req.flash('success', 'Proof submitted. Awaiting admin confirmation.');
    return res.redirect('/delivery/dashboard');
  }

  delivery.status = status;
  req.flash('success', 'Delivery status updated successfully.');
  res.redirect('/delivery/dashboard');
});


app.listen(PORT, () => {
  console.log('Toy store dApp frontend running on http://localhost:' + PORT);
});

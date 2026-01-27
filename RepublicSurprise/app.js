const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const users = {}; // simple in-memory user store for demo
const products = [];
let lastProductId = null;
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 3 } });

const normalizeWalletAddress = (address) => (address || '').trim().toLowerCase();
const normalizeDisplayName = (value) => (value || '').trim().toLowerCase();
const normalizeContactNumber = (value) => (value || '').replace(/\D/g, '');
const getUserByWallet = (address) => {
  const key = normalizeWalletAddress(address);
  if (!key) return null;
  return users[key] || null;
};
const setUserByWallet = (address, data) => {
  const key = normalizeWalletAddress(address);
  if (!key) return null;
  users[key] = data;
  return key;
};
const walletAddressExists = (address) => !!getUserByWallet(address);
const displayNameExists = (name) => {
  const normalized = normalizeDisplayName(name);
  if (!normalized) return false;
  return Object.values(users).some((user) => normalizeDisplayName(user.name) === normalized);
};
const contactNumberExists = (contact) => {
  const normalized = normalizeContactNumber(contact);
  if (!normalized) return false;
  return Object.values(users).some((user) => normalizeContactNumber(user.contact) === normalized);
};

const getActiveProducts = () => products.filter((item) => item.active !== false);

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

const userFields = ['name', 'walletAddress', 'role', 'address', 'contact', 'active'];

const pickProductFields = (source) =>
  productFields.reduce((acc, key) => {
    acc[key] = source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : '';
    return acc;
  }, {});

const pickUserFields = (source) =>
  userFields.reduce((acc, key) => {
    acc[key] = source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : '';
    return acc;
  }, {});

const buildAuditEntry = (action, actor, before, after) => {
  const beforeSnapshot = before ? pickProductFields(before) : null;
  const afterSnapshot = after ? pickProductFields(after) : null;
  const changes = [];
  const timestamp = new Date().toISOString();

  if (beforeSnapshot && afterSnapshot) {
    productFields.forEach((key) => {
      if (beforeSnapshot[key] !== afterSnapshot[key]) {
        changes.push({ field: key, from: beforeSnapshot[key], to: afterSnapshot[key] });
      }
    });
  }

  const snapshot = afterSnapshot || beforeSnapshot;
  const payload = JSON.stringify({ action, actor: actor || 'system', timestamp, changes, snapshot });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  return {
    action,
    actor: actor || 'system',
    timestamp,
    changes,
    snapshot,
    hash
  };
};

const buildUserAuditEntry = (action, actor, before, after) => {
  const beforeSnapshot = before ? pickUserFields(before) : null;
  const afterSnapshot = after ? pickUserFields(after) : null;
  const changes = [];
  const timestamp = new Date().toISOString();

  if (beforeSnapshot && afterSnapshot) {
    userFields.forEach((key) => {
      if (beforeSnapshot[key] !== afterSnapshot[key]) {
        changes.push({ field: key, from: beforeSnapshot[key], to: afterSnapshot[key] });
      }
    });
  }

  const snapshot = afterSnapshot || beforeSnapshot;
  const payload = JSON.stringify({ action, actor: actor || 'system', timestamp, changes, snapshot });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  return {
    action,
    actor: actor || 'system',
    timestamp,
    changes,
    snapshot,
    hash
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

app.get('/user/profile', allowRoles(['user']), (req, res) => {
  const walletAddress = req.session.user?.walletAddress || '';
  const user = getUserByWallet(walletAddress);
  if (!user) {
    req.flash('error', 'User profile not found. Please log in again.');
    return res.redirect('/login');
  }
  res.render('user-profile', { user });
});

app.post('/user/profile', allowRoles(['user']), (req, res) => {
  const walletAddress = req.session.user?.walletAddress || '';
  const userKey = normalizeWalletAddress(walletAddress);
  const user = userKey ? users[userKey] : null;
  if (!user) {
    req.flash('error', 'User profile not found. Please log in again.');
    return res.redirect('/login');
  }
  const { name, address, contact } = req.body;
  const errors = [];
  if (!name) errors.push('Name is required.');
  if (!address) errors.push('Address is required.');
  if (!contact) errors.push('Contact number is required.');

  if (errors.length) {
    errors.forEach((msg) => req.flash('error', msg));
    return res.redirect('/user/profile');
  }

  const updated = {
    ...user,
    name,
    address,
    contact
  };
  const entry = buildUserAuditEntry('updated', req.session.user?.walletAddress, user, updated);
  updated.history = [...(user.history || []), entry];
  users[userKey] = updated;
  req.flash('success', 'Profile updated. Redirecting to product listings.');
  return res.redirect('/shopping');
});

app.get('/register', (_req, res) => {
  res.render('registration');
});

app.post('/register', (req, res) => {
  const { name, walletAddress, address, contact, role } = req.body;
  const walletAddressRaw = (walletAddress || '').trim();
  const errors = [];
  if (!name) errors.push('Name is required.');
  if (!walletAddressRaw) errors.push('Wallet address is required.');
  if (!address) errors.push('Address is required.');
  if (!contact) errors.push('Contact number is required.');
  if (!role) errors.push('Role is required.');
  const allowedRoles = ['user', 'admin', 'delivery man'];
  if (role && !allowedRoles.includes(role)) errors.push('Invalid role selected.');
  if (walletAddressRaw && walletAddressExists(walletAddressRaw)) errors.push('Wallet address already exists.');
  if (name && displayNameExists(name)) errors.push('Full name already exists. Please use another name.');
  if (contact && contactNumberExists(contact)) errors.push('Contact number already exists. Please use a different number.');

  if (errors.length) {
    errors.forEach((msg) => req.flash('error', msg));
    return res.redirect('/register');
  }

  const newUser = {
    name,
    walletAddress: walletAddressRaw,
    address,
    contact,
    role,
    active: true,
    createdAt: new Date().toISOString(),
    history: []
  };
  newUser.history.push(buildUserAuditEntry('created', walletAddressRaw, null, newUser));
  setUserByWallet(walletAddressRaw, newUser);
  req.session.user = { walletAddress: walletAddressRaw, role };
  req.flash('success', 'Registration successful.');
  if (role === 'admin') return res.redirect('/admin/dashboard');
  if (role === 'delivery man') return res.redirect('/delivery/dashboard');
  return res.redirect('/user/home');
});

app.get('/register/check-wallet', (req, res) => {
  const walletAddress = (req.query.walletAddress || '').trim();
  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required.' });
  }
  return res.json({ inUse: walletAddressExists(walletAddress) });
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
  const { walletAddress } = req.body;
  const walletAddressRaw = (walletAddress || '').trim();
  if (!walletAddressRaw) {
    req.flash('error', 'Wallet address is required.');
    return res.redirect('/login');
  }

  const user = getUserByWallet(walletAddressRaw);
  if (!user) {
    req.flash('error', 'Wallet address not found.');
    return res.redirect('/login');
  }
  if (user.active === false) {
    req.flash('error', 'This account is deactivated. Please contact support.');
    return res.redirect('/login');
  }

  req.session.user = { walletAddress: user.walletAddress, role: user.role };
  req.flash('success', 'Logged in successfully.');
  if (user.role === 'admin') return res.redirect('/admin/dashboard');
  if (user.role === 'delivery man') return res.redirect('/delivery/dashboard');
  return res.redirect('/user/home');
});

app.get('/admin/dashboard', allowRoles(['admin']), (req, res) => {
  res.render('admin-home');
});
app.get('/admin/orders', allowRoles(['admin']), (_req, res) => {
  const driversByWallet = Object.values(users).reduce((acc, user) => {
    const key = normalizeWalletAddress(user.walletAddress);
    if (key) acc[key] = user;
    return acc;
  }, {});
  res.render('admin-orders', { orders, deliveries, drivers: driversByWallet });
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
  const delivery = deliveries.find((d) => d.orderNumber === order.id || d.id === order.id || d.deliveryId === order.id) || null;
  res.render('admin-order-completion-check', { order, delivery });
});

app.post('/admin/orders/confirm/:id', allowRoles(['admin']), (req, res) => {
  const target = orders.find((o) => o.id === req.params.id);
  if (target) {
    if (target.status === 'Pending Delivery Confirmation') {
      const linkedDelivery = deliveries.find((d) => d.orderNumber === target.id || d.id === target.id || d.deliveryId === target.id);
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
    walletAddress: u.walletAddress,
    role: u.role,
    address: u.address,
    contact: u.contact,
    active: u.active !== false,
    historyCount: (u.history || []).length
  }));
  res.render('admin-users', { users: list });
});

app.get('/admin/users/history/:walletAddress', allowRoles(['admin']), (req, res) => {
  const walletAddress = req.params.walletAddress;
  const user = getUserByWallet(walletAddress);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  const history = user.history || [];
  res.render('admin-user-history', { user, history });
});

app.get('/admin/users/edit/:walletAddress', allowRoles(['admin']), (req, res) => {
  const walletAddress = req.params.walletAddress;
  const user = getUserByWallet(walletAddress);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  res.render('admin-user-edit', { user });
});

app.post('/admin/users/edit/:walletAddress', allowRoles(['admin']), (req, res) => {
  const targetWallet = req.params.walletAddress;
  const targetKey = normalizeWalletAddress(targetWallet);
  const user = targetKey ? users[targetKey] : null;
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  const { name, walletAddress, role, address, contact } = req.body;
  const errors = [];
  const allowedRoles = ['user', 'admin', 'delivery man'];
  if (!role || !allowedRoles.includes(role)) errors.push('Role is required.');
  if (name && name !== user.name) {
    errors.push('Name can only be edited by the user.');
  }
  if (walletAddress && walletAddress !== targetWallet) {
    errors.push('Wallet address cannot be changed.');
  }
  if (address && address !== user.address) {
    errors.push('Address can only be edited by the user.');
  }
  if (contact && contact !== user.contact) {
    errors.push('Contact number can only be edited by the user.');
  }

  if (errors.length) {
    errors.forEach((msg) => req.flash('error', msg));
    return res.redirect(`/admin/users/edit/${encodeURIComponent(targetWallet)}`);
  }

  const updated = {
    ...user,
    walletAddress: targetWallet,
    role
  };
  const entry = buildUserAuditEntry('updated', req.session.user?.walletAddress, user, updated);
  updated.history = [...(user.history || []), entry];

  users[targetKey] = updated;

  req.flash('success', 'User role updated.');
  res.redirect('/admin/users');
});

app.post('/admin/deactivate-user/:walletAddress', allowRoles(['admin']), (req, res) => {
  const walletAddress = req.params.walletAddress;
  const userKey = normalizeWalletAddress(walletAddress);
  const user = userKey ? users[userKey] : null;
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  if (user.active === false) {
    req.flash('error', 'User already deactivated.');
    return res.redirect('/admin/users');
  }
  const updated = { ...user, active: false };
  const entry = buildUserAuditEntry('deactivated', req.session.user?.walletAddress, user, updated);
  updated.history = [...(user.history || []), entry];
  users[userKey] = updated;
  req.flash('success', 'User deactivated.');
  res.redirect('/admin/users');
});

app.post('/admin/reactivate-user/:walletAddress', allowRoles(['admin']), (req, res) => {
  const walletAddress = req.params.walletAddress;
  const userKey = normalizeWalletAddress(walletAddress);
  const user = userKey ? users[userKey] : null;
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  if (user.active !== false) {
    req.flash('error', 'User already active.');
    return res.redirect('/admin/users');
  }
  const updated = { ...user, active: true };
  const entry = buildUserAuditEntry('reactivated', req.session.user?.walletAddress, user, updated);
  updated.history = [...(user.history || []), entry];
  users[userKey] = updated;
  req.flash('success', 'User reactivated.');
  res.redirect('/admin/users');
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

app.get('/admin/customer-service/approve/:id', allowRoles(['admin']), (req, res) => {
  const ticket = refundTickets.find((t) => t.id === req.params.id) || null;
  if (!ticket) {
    req.flash('error', 'Refund ticket not found.');
    return res.redirect('/admin/customer-service');
  }
  res.render('admin-refund-approve', { ticket });
});

app.post('/admin/customer-service/approve/:id', allowRoles(['admin']), (req, res) => {
  const ticket = refundTickets.find((t) => t.id === req.params.id);
  if (!ticket) {
    req.flash('error', 'Refund ticket not found.');
    return res.redirect('/admin/customer-service');
  }
  const { refundType, requestNewItem } = req.body;
  ticket.type = refundType || ticket.type || 'Pending';
  ticket.status = 'Approved';
  if (refundType === 'Partial' && requestNewItem) {
    const newDeliveryId = 'DEL-' + Date.now().toString().slice(-5);
    deliveries.push({
      id: newDeliveryId,
      deliveryId: newDeliveryId,
      orderNumber: ticket.orderId,
      customer: ticket.customer,
      status: 'Pending',
      proofImage: null,
      address: ticket.address || '',
      contact: ticket.contact || ''
    });
  }
  req.flash('success', `Refund ${ticket.id} approved.`);
  res.redirect('/admin/customer-service');
});
//gul
const deliveries = [
  { id: 'DEL-001', deliveryId: 'DEL-001', orderNumber: 'ORD-1001', customer: '0xA1b2c3D4e5F678901234567890abcdef12345678', status: 'Out for Delivery', proofImage: null },
  { id: 'DEL-002', deliveryId: 'DEL-002', orderNumber: 'ORD-1002', customer: '0xB2c3D4e5F678901234567890abcdef1234567890', status: 'Pending', proofImage: null },
  { id: 'DEL-003', deliveryId: 'DEL-003', orderNumber: 'ORD-1003', customer: '0xC3d4E5f678901234567890abcdef1234567890Ab', status: 'Completed', proofImage: null },
  // Sample entry for local testing: Order ID 1023 assigned to demo delivery man
  { id: 'DEL-1023', deliveryId: 'DEL-1023', orderNumber: '1023', customerName: 'John Tan', address: '12 Orchard Road', status: 'out_for_delivery', assignedTo: '0x9a966d7e74B87279448E82b4652c4b7012ba2feE', proofImage: null }
];

// Add a demo delivery-man user so you can log in locally with wallet '0x9a966d7e74B87279448E82b4652c4b7012ba2feE'
users[normalizeWalletAddress('0x9a966d7e74B87279448E82b4652c4b7012ba2feE')] = {
  name: 'Demo Driver 9A',
  walletAddress: '0x9a966d7e74B87279448E82b4652c4b7012ba2feE',
  role: 'delivery man',
  address: 'Depot',
  contact: '0000',
  active: true,
  createdAt: new Date().toISOString(),
  history: []
};

const orders = [
  { id: 'ORD-1001', product: 'Mystery Box A', customer: '0xA1b2c3D4e5F678901234567890abcdef12345678', price: 49.9, qty: 2, status: 'Pending Delivery Confirmation' },
  { id: 'ORD-1002', product: 'Mystery Box B', customer: '0xB2c3D4e5F678901234567890abcdef1234567890', price: 59.9, qty: 1, status: 'Pending Delivery Confirmation' },
  { id: 'ORD-1003', product: 'Mystery Box C', customer: '0xC3d4E5f678901234567890abcdef1234567890Ab', price: 39.9, qty: 3, status: 'Confirmed' }
];

const refundTickets = [
  { id: 'RF-2001', customer: '0xD4e5F678901234567890abcdef1234567890AbCd', orderId: 'ORD-0999', amount: 29.9, type: 'Partial', status: 'Open' },
  { id: 'RF-2002', customer: '0xE5f678901234567890abcdef1234567890AbCdE', orderId: 'ORD-0998', amount: 59.9, type: 'Full', status: 'In Review' }
];



// (delivery dashboard implemented later with deliveryName/stats/filters)

// Create a delivery record (called from payment page after successful payment)
// Create a delivery record (called from payment page after successful payment)
app.post('/create-delivery', (req, res) => {
  const { orderId, customerName: bodyName, address: bodyAddress, customerWallet, contact: bodyContact } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });
  const newId = 'DEL-' + Date.now().toString().slice(-6);
  // Prefer explicit name/address from request; otherwise try to resolve from wallet
  let customerName = bodyName || 'Guest';
  let address = bodyAddress || '';
  let contact = bodyContact || '';
  if ((!bodyName || !bodyName.length || !bodyAddress) && customerWallet) {
    const user = getUserByWallet(customerWallet);
    if (user) {
      customerName = user.name || customerWallet;
      address = user.address || address;
      contact = user.contact || contact;
    }
  }
  if ((!bodyName || !bodyName.length) && customerWallet) {
    const user = getUserByWallet(customerWallet);
    if (user) {
      customerName = user.name || customerWallet;
      address = user.address || '';
      contact = user.contact || '';
    } else {
      customerName = customerWallet;
    }
  }
  const entry = {
    id: newId,
    deliveryId: newId,
    orderNumber: orderId,
    customerName,
    address,
    contact,
    customerWallet: customerWallet || '',
    status: 'pending',
    assignedTo: null,
    assignedAt: null,
    proofImage: null
  };
  deliveries.push(entry);
  return res.json({ success: true, delivery: entry });
});

app.post('/create-order', (req, res) => {
  const { orderId, customerWallet, customerName: bodyName, contact: bodyContact, address: bodyAddress, product, price, qty, status } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }
  const existing = orders.find((o) => o.id === orderId || o.orderId === orderId);
  if (existing) {
    req.session.cart = [];
    return res.json({ success: true, order: existing });
  }
  let customerName = bodyName;
  let contact = bodyContact;
  let address = bodyAddress;
  if (customerWallet) {
    const user = getUserByWallet(customerWallet);
    if (user) {
      customerName = customerName || user.name || customerWallet;
      contact = contact || user.contact || '';
      address = address || user.address || '';
    }
  }
  const entry = {
    id: orderId,
    product: product || 'Mystery order',
    customer: customerWallet || customerName || 'Guest',
    customerWallet: customerWallet || '',
    customerName: customerName || customerWallet || 'Guest',
    contact: contact || '',
    address: address || '',
    price: Number(price) || 0,
    qty: Number(qty) || 1,
    status: status || 'Pending Delivery Confirmation',
    createdAt: new Date().toISOString()
  };
  orders.push(entry);
  req.session.cart = [];
  return res.json({ success: true, order: entry });
});

// Alias to the delivery dashboard
app.get('/delivery-home', allowRoles(['delivery man']), (req, res) => {
  return res.redirect('/delivery/dashboard');
});

// Delivery dashboard: show deliveries assigned to logged-in delivery man with stats and filters
app.get('/delivery/dashboard', allowRoles(['delivery man']), (req, res) => {
  const wallet = req.session.user?.walletAddress;
  const user = getUserByWallet(wallet);
  const deliveryName = (user && user.name) ? user.name : (wallet || 'Delivery User');

  const normalizedWallet = normalizeWalletAddress(wallet);
  const assignedList = deliveries.filter((d) => normalizeWalletAddress(d.assignedTo) === normalizedWallet);
  const pendingList = deliveries.filter((d) => !d.assignedTo && d.status === 'pending');

  const stats = {
    assigned: assignedList.filter((d) => ['assigned', 'out_for_delivery'].includes(String(d.status).toLowerCase())).length,
    pending: pendingList.length,
    delivered_pending: assignedList.filter((d) => String(d.status).toLowerCase() === 'delivered_pending').length
  };

  let list = [...assignedList];
  const q = (req.query.q || '').toLowerCase().trim();
  const statusFilter = (req.query.status || '').toLowerCase();
  if (statusFilter) list = list.filter((d) => String(d.status || '').toLowerCase() === statusFilter);
  if (q) {
    list = list.filter((d) => {
      const customer = String(d.customerName || d.customer || '').toLowerCase();
      const addr = String(d.address || '').toLowerCase();
      const order = String(d.orderNumber || '').toLowerCase();
      return customer.includes(q) || addr.includes(q) || order.includes(q);
    });
  }

  const viewDeliveries = list.map((d) => ({
    id: d.id,
    deliveryId: d.deliveryId || d.id,
    orderNumber: d.orderNumber,
    address: d.address || '',
    status: d.status || '',
    customerName: d.customerName || d.customer || '',
    customerWallet: d.customerWallet || d.customer || '',
    contact: d.contact || '',
    items: d.items || []
  }));

  const viewPending = pendingList.map((d) => ({
    id: d.id,
    deliveryId: d.deliveryId || d.id,
    orderNumber: d.orderNumber,
    address: d.address || '',
    customerName: d.customerName || d.customer || '',
    customerWallet: d.customerWallet || d.customer || '',
    contact: d.contact || ''
  }));

  res.render('delivery-home', { deliveries: viewDeliveries, pendingDeliveries: viewPending, deliveryName, stats });
});

// Assign a pending delivery to the current delivery user
app.post('/deliveries/:id/assign', allowRoles(['delivery man']), (req, res) => {
  const id = req.params.id;
  const target = deliveries.find((d) => d.id === id || d.deliveryId === id);
  if (!target) {
    req.flash('error', 'Delivery not found.');
    return res.redirect('/delivery-home');
  }
  if (target.status !== 'Pending') {
    req.flash('error', 'Delivery is not pending and cannot be assigned.');
    return res.redirect('/delivery-home');
  }
  target.status = 'Assigned';
  target.assignedTo = req.session.user?.walletAddress || 'unknown';
  target.assignedAt = new Date().toISOString();
  req.flash('success', `Delivery ${target.id} assigned to you.`);
  return res.redirect('/delivery-home');
});

app.get('/delivery/order/:id', allowRoles(['delivery man', 'admin']), (req, res) => {
  const delivery = deliveries.find((d) => d.id === req.params.id || d.deliveryId === req.params.id) || null;
  if (!delivery) {
    req.flash('error', 'Order not found.');
    return res.redirect('/delivery/dashboard');
  }
  res.render('delivery-order-detail', { delivery });
});

// Delivery detail view with permission check: delivery man can only view their assigned deliveries
app.get('/deliveries/:id', allowRoles(['delivery man', 'admin']), (req, res) => {
  const id = req.params.id;
  const delivery = deliveries.find((d) => d.id === id || d.deliveryId === id) || null;
  if (!delivery) {
    req.flash('error', 'Delivery not found.');
    return res.redirect('/delivery/dashboard');
  }
  if (req.session.user.role === 'delivery man') {
    const wallet = req.session.user?.walletAddress;
    if (delivery.assignedTo !== wallet) {
      req.flash('error', 'Access denied. This delivery is not assigned to you.');
      return res.redirect('/delivery/dashboard');
    }
  }
  res.render('delivery-order-detail', { delivery });
});

app.post('/deliveries/:id/claim', allowRoles(['delivery man']), (req, res) => {
  const id = req.params.id;
  const delivery = deliveries.find((d) => d.id === id || d.deliveryId === id) || null;
  if (!delivery || delivery.assignedTo) {
    req.flash('error', 'Delivery not found or already assigned.');
    return res.redirect('/delivery/dashboard');
  }
  const wallet = req.session.user?.walletAddress;
  delivery.assignedTo = normalizeWalletAddress(wallet);
  delivery.assignedAt = new Date().toISOString();
  delivery.status = 'out_for_delivery';
  req.flash('success', `Delivery ${delivery.deliveryId || delivery.id} assigned to you.`);
  res.redirect('/delivery/dashboard');
});

// Submit proof of delivery (photo + remarks + optional signature)
app.post('/deliveries/:id/submit-proof', allowRoles(['delivery man']), upload.single('proofImage'), (req, res) => {
  const id = req.params.id;
  const delivery = deliveries.find((d) => d.id === id || d.deliveryId === id) || null;
  if (!delivery) {
    req.flash('error', 'Delivery not found.');
    return res.redirect('/delivery/dashboard');
  }
  const wallet = req.session.user?.walletAddress;
  if (delivery.assignedTo !== wallet) {
    req.flash('error', 'Access denied. This delivery is not assigned to you.');
    return res.redirect('/delivery/dashboard');
  }

  // Accept file and store as base64 for demo
  if (req.file && req.file.buffer) {
    const b64 = req.file.buffer.toString('base64');
    delivery.proofImage = { data: b64, mimetype: req.file.mimetype, filename: req.file.originalname };
  }
  delivery.remarks = req.body.remarks || '';
  delivery.signature = req.body.signature || '';
  delivery.status = 'delivered_pending';
  delivery.deliveredAt = new Date().toISOString();

  req.flash('success', 'Proof submitted. Awaiting admin confirmation.');
  return res.redirect('/delivery/dashboard');
});

// Delivery history for logged-in delivery man
app.get('/delivery-history', allowRoles(['delivery man']), (req, res) => {
  const wallet = req.session.user?.walletAddress;
  const user = getUserByWallet(wallet);
  const deliveryName = (user && user.name) ? user.name : (wallet || 'Delivery User');
  const history = deliveries.filter((d) => d.assignedTo === wallet && (d.status === 'delivered_pending' || d.status === 'completed'))
    .map((d) => ({ id: d.id, orderNumber: d.orderNumber, customerName: d.customerName || d.customer || '', status: d.status, proofImage: d.proofImage || null, remarks: d.remarks || '' }));
  res.render('delivery-history', { history, deliveryName });
});

// Admin-friendly alias to view delivery details without hitting the delivery dashboard redirect.
app.get('/admin/delivery/:id', allowRoles(['admin']), (req, res) => {
  const delivery = deliveries.find((d) => d.id === req.params.id || d.deliveryId === req.params.id) || null;
  if (!delivery) {
    req.flash('error', 'Order not found.');
    return res.redirect('/admin/orders');
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
  newProduct.history.push(buildAuditEntry('created', req.session.user?.walletAddress, null, newProduct));
  products.push(newProduct);
  lastProductId = newProduct.id;
  req.flash('success', 'Product saved.');
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
    const entry = buildAuditEntry('updated', req.session.user?.walletAddress, before, updated);
    updated.history = [...(before.history || []), entry];
    products[existingIndex] = updated;
    lastProductId = products[existingIndex].id;
  } else {
    const created = createProduct(req.body);
    created.history.push(buildAuditEntry('created', req.session.user?.walletAddress, null, created));
    products.push(created);
    lastProductId = created.id;
  }
  req.flash('success', 'Product updated.');
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
    const entry = buildAuditEntry('deactivated', req.session.user?.walletAddress, before, updated);
    updated.history = [...(before.history || []), entry];
    products[index] = updated;
    if (lastProductId === id) lastProductId = products[index].id;
    req.flash('success', 'Product deactivated.');
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
    const entry = buildAuditEntry('reactivated', req.session.user?.walletAddress, before, updated);
    updated.history = [...(before.history || []), entry];
    products[index] = updated;
    if (lastProductId === id) lastProductId = products[index].id;
    req.flash('success', 'Product reactivated.');
  } else {
    req.flash('error', 'Product not found.');
  }
  res.redirect('/admin/inventory');
});

app.get('/shopping', (_req, res) => {
  const activeProducts = getActiveProducts();
  res.render('shopping', { products: activeProducts });
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

  const activeProducts = getActiveProducts();
  const serverCatalog = normalizeProducts(activeProducts, 0);
  const demoCatalog = normalizeProducts(demoProducts, activeProducts.length);
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
app.get('/payment', allowRoles(['user']), (req, res) => {
  const cart = getCart(req);
  if (!cart.length) {
    req.flash('error', 'Your cart is empty. Add items before proceeding to payment.');
    return res.redirect('/cart');
  }
  return res.render('payment');
});

app.get('/invoice', (req, res) => {
  res.render('invoice');
});

app.get('/order-tracking', allowRoles(['user']), (req, res) => {
  res.render('order-tracking');
});

app.get('/support', (_req, res) => {
  res.render('support');
});

app.post('/support', upload.array('attachments', 2), (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    req.flash('error', 'Please log in with a user account to submit a ticket.');
    return res.redirect('/login');
  }
  const { orderId, reason, description, address, contact } = req.body;
  if (!orderId || !reason) {
    req.flash('error', 'Order number and reason are required.');
    return res.redirect('/support');
  }
  const desc = (description || '').slice(0, 300);
  const files = (req.files || []).filter((f) => ['image/jpeg', 'image/png'].includes(f.mimetype)).slice(0, 2);
  const attachments = files.map((f) => ({
    mimetype: f.mimetype,
    data: `data:${f.mimetype};base64,${f.buffer.toString('base64')}`
  }));
  const ticket = {
    id: 'RF-' + Date.now().toString().slice(-6),
    orderId,
    customer: req.session.user.walletAddress,
    amount: 0,
    type: 'Pending',
    reason,
    description: desc,
    requestNewItem: false,
    address: address || '',
    contact: contact || '',
    status: 'Open',
    attachments,
    createdAt: new Date().toISOString()
  };
  refundTickets.push(ticket);
  req.flash('success', 'Support ticket submitted.');
  res.redirect('/support');
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

app.post('/cart/clear', allowRoles(['user']), (req, res) => {
  req.session.cart = [];
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
  const deliveryId = 'DEL-' + Date.now().toString().slice(-5);
  deliveries.push({
    id: deliveryId,
    orderNumber,
    deliveryId,
    customer: customer || 'Unknown',
    status: status || 'Pending',
    proofImage: null
  });
  req.flash('success', 'Delivery added successfully.');
  res.redirect('/delivery/dashboard');
});

// GET route for Update Delivery Status
app.get('/delivery/update-status', allowRoles(['delivery man', 'admin']), (req, res) => {
  res.render('delivery-update-status', { deliveries }); // pass deliveries to the EJS
});

// POST route for Update Delivery Status
app.post('/delivery/update-status', allowRoles(['delivery man', 'admin']), upload.single('proof'), (req, res) => {
  const { id, status } = req.body;
  const redirectUrl = req.session.user?.role === 'admin' ? '/delivery/update-status' : '/delivery/dashboard';
  const delivery = deliveries.find((d) => d.id === id || d.deliveryId === id);
  if (!delivery) {
    req.flash('error', 'Delivery not found.');
    return res.redirect(redirectUrl);
  }

  if (status === 'Completed' && req.session.user?.role !== 'admin') {
    req.flash('error', 'Only admins can mark a delivery as completed.');
    return res.redirect(redirectUrl);
  }

  if (delivery.status === 'Completed' && !hasApprovedRefund(id)) {
    req.flash('error', 'Completed orders cannot be changed unless a refund was approved.');
    return res.redirect(redirectUrl);
  }

  // If delivery man moves to pending confirmation, require proof and hold for admin approval.
  if (status === 'Pending confirmation') {
    if (req.session.user?.role !== 'admin' && (!req.file || !['image/jpeg', 'image/png'].includes(req.file.mimetype))) {
      req.flash('error', 'Please upload a .jpg or .png proof image to mark delivery.');
      return res.redirect(redirectUrl);
    }
    if (req.session.user?.role !== 'admin') {
      const proofImage = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      delivery.proofImage = proofImage;
    }
    delivery.status = 'Pending confirmation';
    const linkedOrder = orders.find((o) => o.id === delivery.orderNumber);
    if (linkedOrder) linkedOrder.status = 'Pending Delivery Confirmation';
    req.flash('success', 'Proof submitted. Awaiting admin confirmation.');
    return res.redirect(redirectUrl);
  }

  delivery.status = status;
  req.flash('success', 'Delivery status updated successfully.');
  res.redirect(redirectUrl);
});


app.listen(PORT, () => {
  console.log('Toy store dApp frontend running on http://localhost:' + PORT);
});

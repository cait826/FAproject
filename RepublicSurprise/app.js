const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Web3 } = require('web3');

// Express app setup
const app = express();
const PORT = process.env.PORT || 3001;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

// Multer storage for uploaded pet images
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
  filename: (_req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Global state shared with views
let account = '';
let noOfPets = 0;
let loading = true;
let addObj = null;
let addFunc = null;
let addEnabled = null;
let listOfPets = [];
let currentUser = null;
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

// Home page
app.get('/', (_req, res) => {
  // Using existing home.ejs view (no index.ejs in project)
  res.render('home', {
    acct: account,
    cnt: noOfPets,
    pets: listOfPets,
    status: loading,
    addObject: JSON.stringify(addObj),
    addFunction: addFunc,
    addStatus: addEnabled,
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
  const { walletAddress, name, role } = req.body;
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
  users[wallet] = { walletAddress, name: name || 'User', role: role || 'user' };
  currentUser = users[wallet];
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
  if (currentUser.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  res.redirect('/user/home');
});

app.post('/logout', (_req, res) => {
  currentUser = null;
  res.redirect('/');
});

// Minimal user home route
app.get('/user/home', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  res.render('user-home', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

// Basic stubs for navigation links used in header
app.get('/user/profile', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  res.render('user-profile', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

app.get('/shopping', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
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

app.get('/order-tracking', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  res.render('order-tracking', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    orders: []
  });
});

app.get('/support', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  res.render('support', {
    user: currentUser,
    errorMessages: [],
    successMessages: []
  });
});

// Update profile
app.post('/user/profile', (req, res) => {
  if (!currentUser) return res.redirect('/login');
  const { name, contact, address } = req.body;
  currentUser.name = name || currentUser.name;
  currentUser.contact = contact || currentUser.contact;
  currentUser.address = address || currentUser.address;
  res.render('user-profile', {
    user: currentUser,
    errorMessages: [],
    successMessages: ['Profile updated']
  });
});

// Support ticket stub (accept up to 2 attachments)
app.post('/support', upload.array('attachments', 2), (req, res) => {
  if (!currentUser) return res.redirect('/login');
  if (!req.body.orderId || !req.body.reason) {
    return res.status(400).render('support', {
      user: currentUser,
      errorMessages: ['Order number and reason are required'],
      successMessages: []
    });
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
  const wallet = currentUser.walletAddress?.toLowerCase();
  const cart = carts[wallet] || [];
  carts[wallet] = cart.filter((p) => String(p.id) !== String(req.params.id));
  const cartCount = (carts[wallet] || []).reduce((sum, p) => sum + Number(p.qty || 0), 0);
  const totals = getCartTotals(carts[wallet]);
  return respondCart(req, res, { success: true, cartCount, totals });
});

app.post('/cart/clear', (req, res) => {
  if (!currentUser) return res.status(401).json({ redirect: '/login' });
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

function respondCart(req, res, payload) {
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    return res.redirect('/cart');
  }
  return res.json(payload);
}

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
    active: true
  };
}

// Payment page (stub)
app.get('/payment', (_req, res) => {
  if (!currentUser) return res.redirect('/login');
  const cart = carts[currentUser.walletAddress?.toLowerCase()] || [];
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

  products.push(
    seedProduct(
      `prod-${nextId}`,
      productName || 'New Product',
      indivPriceNum || Number(priceWei || 0) || setPriceNum,
      indivStockNum || setStockNum,
      badge,
      '/images/lolo_the_piggy.png',
      productDescription || '',
      enableIndividualBool,
      enableSetBool,
      setPriceNum,
      setStockNum,
      setBoxesNum
    )
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
    orders: []
  });
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

app.get('/admin/users/edit/:wallet', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const wallet = (req.params.wallet || '').toLowerCase();
  const target = users[wallet];
  if (!target) return res.status(404).send('User not found');
  res.render('admin-user-edit', {
    user: currentUser,
    errorMessages: [],
    successMessages: [],
    targetUser: target
  });
});

app.post('/admin/users/edit/:wallet', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const wallet = (req.params.wallet || '').toLowerCase();
  const target = users[wallet];
  if (!target) return res.status(404).send('User not found');
  const { name, address, contact, role } = req.body;
  target.name = name || target.name;
  target.address = address || target.address;
  target.contact = contact || target.contact;
  target.role = role || target.role;
  res.redirect('/admin/users');
});

app.post('/admin/reactivate-user/:wallet', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const wallet = (req.params.wallet || '').toLowerCase();
  const target = users[wallet];
  if (target) target.active = true;
  res.redirect('/admin/users');
});

app.post('/admin/deactivate-user/:wallet', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const wallet = (req.params.wallet || '').toLowerCase();
  const target = users[wallet];
  if (target) target.active = false;
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

// Admin product update/deactivate/reactivate
app.get('/admin/update-product', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.query.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (!product) return res.status(404).send('Product not found');
  res.render('admin-update-product', {
    user: currentUser,
    product,
    productId: product.id,
    hasProduct: true,
    errorMessages: [],
    successMessages: []
  });
});

const updateProductHandler = (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.params.id || req.query.id || req.body.productId || req.body.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (!product) return res.status(404).send('Product not found');

  const {
    productName,
    productDescription,
    individualPrice,
    individualStock,
    setPrice,
    setStock,
    setBoxes,
    enableIndividual,
    enableSet
  } = req.body || {};

  const enableIndividualBool = enableIndividual === 'on' || enableIndividual === true || enableIndividual === 'true';
  const enableSetBool = enableSet === 'on' || enableSet === true || enableSet === 'true';

  product.name = productName || product.name;
  product.productName = productName || product.productName;
  product.productDescription = productDescription || product.productDescription;
  product.description = product.productDescription;
  product.enableIndividual = enableIndividualBool;
  product.enableSet = enableSetBool;
  product.individualPrice = Number(individualPrice || 0) || 0;
  product.individualStock = Number(individualStock || 0) || 0;
  product.setPrice = Number(setPrice || 0) || 0;
  product.setStock = Number(setStock || 0) || 0;
  product.setBoxes = Number(setBoxes || 0) || 0;
  product.price = product.individualPrice || product.setPrice || product.price;
  product.stock = product.individualStock || product.setStock || product.stock;
  product.badge = enableSetBool && enableIndividualBool ? 'Single & Set' : enableSetBool ? 'Set' : 'Single box';

  res.redirect('/admin/inventory');
};

app.post('/admin/update-product', express.urlencoded({ extended: true }), updateProductHandler);
app.post('/admin/update-product/:id', express.urlencoded({ extended: true }), updateProductHandler);

app.post('/admin/deactivate-product/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.params.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (product) product.active = false;
  res.redirect('/admin/inventory');
});

app.post('/admin/reactivate-product/:id', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
  const id = req.params.id;
  const product = products.find((p) => String(p.id) === String(id));
  if (product) product.active = true;
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
    history: [],
    errorMessages: [],
    successMessages: []
  });
});

// Product detail
app.get('/product', (req, res) => {
  if (!currentUser) return res.redirect('/login');
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

// Receive data fetched from smart contract via frontend Web3
app.post('/web3ConnectData', (req, res) => {
  try {
    const { petDataRead = [], contractAddress: clientAddress, acct, nPets = 0 } = req.body;
    account = acct || '';
    noOfPets = Number(nPets) || 0;
    if (clientAddress && !contractAddress) contractAddress = clientAddress;

    listOfPets = petDataRead.slice(0, noOfPets).map((entry, idx) => ({
      id: idx + 1,
      petInfo: formatPetInfo(entry.petInfo),
      ownership: formatOwnershipInfo(entry.ownershipInfo || []),
      vaccinations: formatVaccinationInfo(entry.vaccinationInfo || []),
      training: formatTrainingInfo(entry.trainingInfo || [])
    }));
    loading = false;

    return res.json({ success: true, data: listOfPets, message: 'Pet data processed successfully' });
  } catch (error) {
    console.error('Error in web3ConnectData:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Expose loading flag for polling from frontend
app.get('/loading-status', (_req, res) => {
  res.json({ loading });
});

// Single pet page
app.get('/pet/:id', (req, res) => {
  try {
    const petId = req.params.id;
    const index = listOfPets.findIndex((pet) => pet.id.toString() === petId.toString());
    if (index === -1) return res.status(404).send('Pet not found');
    res.render('pet', { acct: account, petData: listOfPets[index], loading: false });
  } catch (error) {
    console.error('Error in pet route:', error);
    res.status(500).send('Error finding pet');
  }
});

// Add pet form
app.get('/addPet', (_req, res) => {
  res.render('addPet', { acct: account });
});

// Handle pet creation request from frontend (actual chain tx handled client-side)
app.post('/addPet', upload.single('image'), (req, res) => {
  try {
    const { petId, name, dob, gender, price } = req.body;
    if (!petId || !name || !dob || !gender || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    addFunc = 'addPetInfo';
    addEnabled = true;
    addObj = { petId, name, dob, gender, price };
    res.redirect('/');
  } catch (error) {
    console.error('Error in pet registration:', error);
    res.status(500).send('Error adding pet');
  }
});

// Reset action flag after frontend processes tx
app.post('/setFunc', (_req, res) => {
  addEnabled = null;
  res.json({ success: true, message: 'set data successfully' });
});

app.get('/addVaccination/:id', (req, res) => {
  res.render('addVaccination', { acct: account, petId: req.params.id });
});

app.post('/addVaccination', (req, res) => {
  try {
    const { vaccine, dateOfVaccine, doctor, clinic, contact, emailId, petId } = req.body;
    if (!petId || !vaccine || !dateOfVaccine || !doctor || !clinic || !contact || !emailId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    addFunc = 'addVaccination';
    addEnabled = true;
    addObj = { petId, vaccine, dateOfVaccine, doctor, clinic, contact, emailId };
    res.redirect('/');
  } catch (error) {
    console.error('Error adding vaccination:', error);
    res.status(500).send('Error adding pet vaccine');
  }
});

app.get('/addTraining/:id', (req, res) => {
  res.render('addTraining', { acct: account, petId: req.params.id });
});

app.post('/addTraining', (req, res) => {
  try {
    const { trainingType, name, org, trainingDate, contact, progress, petId } = req.body;
    if (!petId || !name || !org || !trainingDate || !contact || !progress || !trainingType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    addFunc = 'addTraining';
    addEnabled = true;
    addObj = { petId, name, org, trainingDate, contact, progress, trainingType };
    res.redirect('/');
  } catch (error) {
    console.error('Error adding training:', error);
    res.status(500).send('Error adding pet training');
  }
});

app.get('/addOwner/:id', (req, res) => {
  res.render('addOwner', { acct: account, petId: req.params.id });
});

app.post('/addOwner', (req, res) => {
  try {
    const { ownerId, name, transferDate, contact, emailId, petId } = req.body;
    if (!petId || !name || !ownerId || !transferDate || !contact || !emailId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    addFunc = 'addOwner';
    addEnabled = true;
    addObj = { petId, name, ownerId, transferDate, contact, emailId };
    res.redirect('/');
  } catch (error) {
    console.error('Error adding pet owner:', error);
    res.status(500).send('Error adding pet owner');
  }
});

app.post('/buyPet/:id', (req, res) => {
  try {
    const petId = req.params.id;
    const { petCost } = req.body;
    if (!petId || !petCost) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    addFunc = 'buyPet';
    addEnabled = true;
    addObj = { petId, petCost };
    res.redirect('/');
  } catch (error) {
    console.error('Error in buyPet:', error);
    res.status(500).send('Error buying pet');
  }
});

// Helper formatting functions
function formatPetInfo(petInfo = []) {
  return {
    id: petInfo[0],
    name: petInfo[1],
    dateOfBirth: petInfo[2],
    gender: petInfo[3],
    price: petInfo[4],
    status: petInfo[5]
  };
}

function formatOwnershipInfo(ownershipInfo = []) {
  return ownershipInfo.map((record) => ({
    ownerId: record[0],
    ownerName: record[1],
    transferDate: record[2],
    phone: record[3],
    email: record[4]
  }));
}

function formatVaccinationInfo(vaccinationInfo = []) {
  return vaccinationInfo.map((record) => ({
    vaccineName: record[0],
    dateAdministered: record[1],
    doctorname: record[2],
    clinic: record[3],
    phone: record[4],
    email: record[5]
  }));
}

function formatTrainingInfo(trainingInfo = []) {
  return trainingInfo.map((record) => ({
    trainingType: record[0],
    traninerName: record[1],
    organization: record[2],
    phone: record[3],
    trainingDate: record[4],
    progress: record[5]
  }));
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

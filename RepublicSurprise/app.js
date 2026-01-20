const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');

const app = express();
const PORT = 3000;

const users = {}; // simple in-memory user store for demo

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

app.use((req, res, next) => {
  res.locals.errorMessages = req.flash('error');
  res.locals.successMessages = req.flash('success');
  res.locals.user = req.session.user || null;
  next();
});

const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    req.flash('error', 'please log in to view this page');
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

app.get('/delivery/dashboard', allowRoles(['delivery man']), (req, res) => {
  res.render('delivery-home');
});

const protectedRoutes = [
  { path: '/mainpage', roles: ['user'], title: 'Main Page' },
  { path: '/shopping', roles: ['user'], title: 'Shopping Page' },
  { path: '/product', roles: ['user'], title: 'Product Page' },
  { path: '/order-tracking', roles: ['user'], title: 'Order Tracking' },
  { path: '/cart', roles: ['user'], title: 'Cart Page' },
  { path: '/payment', roles: ['user'], title: 'Payment Page' },
  { path: '/invoice', roles: ['user'], title: 'Invoice Page' },
  { path: '/admin/add-product', roles: ['admin'], title: 'Add Product' },
  { path: '/admin/update-product', roles: ['admin'], title: 'Update Product' },
  { path: '/delivery/add-status', roles: ['delivery man'], title: 'Add Delivery Status' },
  { path: '/delivery/update-status', roles: ['delivery man'], title: 'Update Delivery Status' }
];

protectedRoutes.forEach(({ path: routePath, roles, title }) => {
  app.get(routePath, allowRoles(roles), (req, res) => {
    res.send(`<h1>${title}</h1><p>Accessible by role: ${req.session.user.role}</p>`);
  });
});

app.listen(PORT, () => {
  console.log('Toy store dApp frontend running on http://localhost:' + PORT);
});

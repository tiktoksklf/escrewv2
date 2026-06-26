const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dbFile = process.env.DB_FILE || path.join(root, "data", "db.json");
const dataDir = path.dirname(dbFile);
const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const sessions = new Map();
const csrfTokens = new Map();
const rateBuckets = new Map();

const escrowWallets = {
  SOL: process.env.SOL_WALLET || "AE6vaxpfmPDtJNd1e5oboN5uZFqVYJMuwDyqykrCADvY",
  BTC: process.env.BTC_WALLET || "bc1q4h9qnd5slacywkl87umlzxe9zxnpjjjzrjyed2",
  LTC: process.env.LTC_WALLET || "LKhmv1GteaCj2eNREN9iMYdZNzbzDo2Gap",
  ETH: process.env.ETH_WALLET || "0xb446020017eCb21F3ffE3DED59c770cFA0A1A96F"
};

const categories = ["Development", "Design", "Writing", "Marketing", "Consulting", "Digital Goods", "Physical Goods"];
const orderStatuses = ["unpaid", "paid", "in_escrow", "shipped", "delivered", "completed", "refunded", "cancelled", "disputed"];
const blockedTerms = [
  "stolen", "credential", "credentials", "password", "malware", "ransomware", "phishing", "counterfeit",
  "drugs", "weapon", "fake id", "hacked", "botnet", "exploit kit", "bank log", "carded", "ssn"
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function id() {
  return crypto.randomUUID();
}

function today() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 160000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const actual = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(actual));
}

function seedDb() {
  const ownerId = id();
  const sellerId = id();
  const buyerId = id();
  const now = Date.now();
  const listings = [
    listingSeed(sellerId, "Solidity contract review", "Development", 420, "ETH", "Service", false, "Line-by-line review for a smart contract with risk notes, remediation steps, and a final summary.", "Private report PDF and annotated code notes.", now - 7200000),
    listingSeed(sellerId, "Brand launch kit", "Design", 180, "LTC", "Digital good", true, "Logo concepts, palette, social templates, and launch graphics for legal projects.", "Downloadable design package after escrow confirmation.", now - 3600000),
    listingSeed(ownerId, "Marketplace moderation setup", "Consulting", 650, "BTC", "Service", false, "Policy review, reporting workflow, admin queue setup, and dispute response templates.", "Calendar link and secure shared workspace invite.", now - 1800000),
    listingSeed(sellerId, "Handmade desk accessory", "Physical Goods", 95, "SOL", "Physical good", false, "Small-batch aluminum desk stand shipped with tracking.", "Tracking number and shipping carrier details.", now - 900000)
  ];
  return {
    users: [
      userSeed(ownerId, process.env.OWNER_USERNAME || "zaso", process.env.OWNER_EMAIL || "owner@vault.local", process.env.OWNER_PASSWORD || "owner", "admin", true),
      userSeed(sellerId, "nova", "nova@example.com", "demo", "user", true),
      userSeed(buyerId, "iris", "iris@example.com", "demo", "user", false)
    ],
    listings,
    orders: [],
    payments: [],
    disputes: [],
    messages: [],
    reviews: [],
    reports: [],
    notifications: [],
    favorites: [],
    logs: []
  };
}

function userSeed(userId, username, email, password, role, verified) {
  return {
    id: userId,
    username,
    email,
    passwordHash: hashPassword(password),
    role,
    verified,
    status: "active",
    banReason: "",
    publicBio: "Crypto marketplace member focused on legal goods and services.",
    joinedAt: today(),
    lastLoginAt: null
  };
}

function listingSeed(sellerId, title, category, price, coin, kind, anonymous, description, delivery, createdAt) {
  return {
    id: id(),
    sellerId,
    title,
    category,
    price,
    coin,
    kind,
    anonymous,
    anonymousFeePaid: anonymous,
    deliveryWindow: kind === "Physical good" ? "Ships in 3 business days" : "Delivered in 48 hours",
    description,
    delivery,
    status: "active",
    moderation: "approved",
    reportCount: 0,
    createdAt,
    updatedAt: createdAt
  };
}

function ensureData() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    const db = seedDb();
    log(db, "system", "seed", "Seeded marketplace database.");
    writeDb(db);
  }
}

function readDb() {
  ensureData();
  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

function writeDb(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbFile, `${JSON.stringify(db, null, 2)}\n`);
}

function log(db, actorId, action, detail, meta = {}) {
  db.logs.unshift({ id: id(), actorId, action, detail, meta, createdAt: today() });
}

function notify(db, userId, title, body, type = "info") {
  db.notifications.unshift({ id: id(), userId, title, body, type, read: false, createdAt: today() });
}

function clean(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, email, ...safe } = user;
  return safe;
}

function adminUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function publicListing(db, listing, viewer) {
  const seller = db.users.find((u) => u.id === listing.sellerId);
  const isAdmin = viewer?.role === "admin";
  const isOwner = viewer?.id === listing.sellerId;
  const copy = { ...listing };
  copy.seller = listing.anonymous && !isAdmin && !isOwner
    ? { id: "anonymous", username: "Anonymous seller", anonymous: true }
    : publicUser(seller);
  copy.canSeeOwner = isAdmin || isOwner;
  if (!isAdmin && !isOwner) delete copy.delivery;
  return copy;
}

function getUser(req, db) {
  const sessionId = parseCookies(req).vm_session;
  const userId = sessions.get(sessionId);
  return db.users.find((user) => user.id === userId) || null;
}

function requireUser(req, res, db) {
  const user = getUser(req, db);
  if (!user) return sendJson(res, 401, { error: "Log in first." }), null;
  if (user.status === "banned") return sendJson(res, 403, { error: "This account is banned and cannot use marketplace actions." }), null;
  if (user.status === "suspended") return sendJson(res, 403, { error: "This account is suspended." }), null;
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (user.role !== "admin") return sendJson(res, 403, { error: "Admin permission required." }), null;
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", ...headers }));
  res.end(JSON.stringify(data));
}

function setCookie(res, sessionId) {
  const secure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
  return `vm_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`;
}

function checkRate(req, res) {
  const ip = req.socket.remoteAddress || "local";
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + 60000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 60000;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > 240) {
    sendJson(res, 429, { error: "Too many requests. Slow down." });
    return false;
  }
  return true;
}

function checkCsrf(req, res) {
  if (req.method === "GET" || !req.url.startsWith("/api/")) return true;
  const sessionId = parseCookies(req).vm_session;
  if (!sessionId) return true;
  const expected = csrfTokens.get(sessionId);
  const actual = req.headers["x-csrf-token"];
  if (!expected || expected !== actual) {
    sendJson(res, 403, { error: "Security token expired. Refresh the page." });
    return false;
  }
  return true;
}

function canAccessOrder(user, order) {
  return user.role === "admin" || order.buyerId === user.id || order.sellerId === user.id;
}

function reviewListingInput({ title, description, delivery }) {
  const text = `${title} ${description} ${delivery}`.toLowerCase();
  const hit = blockedTerms.find((term) => text.includes(term));
  return hit ? `Needs review: contains prohibited term "${hit}".` : "Approved by automated moderation.";
}

function stateFor(db, user) {
  const activeListings = db.listings.filter((listing) => {
    const seller = db.users.find((u) => u.id === listing.sellerId);
    return listing.status === "active" && seller?.status !== "banned";
  });
  const scopedOrders = user
    ? db.orders.filter((order) => user.role === "admin" || order.buyerId === user.id || order.sellerId === user.id)
    : [];
  const scopedMessages = user
    ? db.messages.filter((m) => user.role === "admin" || m.fromId === user.id || m.toId === user.id)
    : [];
  return {
    currentUser: user ? publicUser(user) : null,
    csrfToken: user ? csrfTokens.get(parseCookies({ headers: { cookie: "" } }).vm_session) : null,
    escrowWallets,
    categories,
    orderStatuses,
    users: db.users.map(publicUser),
    listings: (user?.role === "admin" ? db.listings : activeListings).map((l) => publicListing(db, l, user)),
    orders: scopedOrders,
    payments: user?.role === "admin" ? db.payments : db.payments.filter((p) => scopedOrders.some((o) => o.id === p.orderId)),
    disputes: user?.role === "admin" ? db.disputes : db.disputes.filter((d) => scopedOrders.some((o) => o.id === d.orderId)),
    messages: scopedMessages,
    reviews: db.reviews,
    reports: user?.role === "admin" ? db.reports : db.reports.filter((r) => r.reporterId === user?.id),
    notifications: user ? db.notifications.filter((n) => n.userId === user.id || (user.role === "admin" && n.userId === "admin")).slice(0, 100) : [],
    favorites: user ? db.favorites.filter((f) => f.userId === user.id) : [],
    admin: user?.role === "admin" ? {
      users: db.users.map(adminUser),
      listings: db.listings.map((l) => publicListing(db, l, user)),
      orders: db.orders,
      payments: db.payments,
      disputes: db.disputes,
      messages: db.messages,
      reports: db.reports,
      logs: db.logs.slice(0, 300)
    } : null
  };
}

async function handleApi(req, res) {
  const db = readDb();
  const user = getUser(req, db);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = req.method === "GET" ? {} : await readBody(req);

  if (req.method === "GET" && url.pathname === "/api/state") {
    const sessionId = parseCookies(req).vm_session;
    const data = stateFor(db, user);
    data.csrfToken = sessionId ? csrfTokens.get(sessionId) : null;
    return sendJson(res, 200, data);
  }

  if (req.method === "POST" && url.pathname === "/api/signup") {
    const username = clean(body.username, 32).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const email = clean(body.email, 120);
    if (username.length < 3 || !email.includes("@") || clean(body.password).length < 4) return sendJson(res, 400, { error: "Use a username, email, and password." });
    if (db.users.some((u) => u.username === username || u.email === email)) return sendJson(res, 409, { error: "Username or email already exists." });
    const newUser = userSeed(id(), username, email, body.password, "user", false);
    db.users.push(newUser);
    log(db, newUser.id, "signup", `${username} created an account.`);
    notify(db, "admin", "New user", `${username} joined the marketplace.`, "user");
    writeDb(db);
    return loginResponse(res, db, newUser);
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const match = db.users.find((u) => u.username === clean(body.username, 32).toLowerCase());
    if (!match || !verifyPassword(body.password, match.passwordHash)) return sendJson(res, 401, { error: "Invalid username or password." });
    if (match.status === "banned") return sendJson(res, 403, { error: `Account banned: ${match.banReason || "No public reason provided."}` });
    if (match.status === "suspended") return sendJson(res, 403, { error: "Account suspended. Contact admin." });
    match.lastLoginAt = today();
    log(db, match.id, "login", `${match.username} logged in.`);
    writeDb(db);
    return loginResponse(res, db, match);
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const sessionId = parseCookies(req).vm_session;
    sessions.delete(sessionId);
    csrfTokens.delete(sessionId);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": "vm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }

  const actor = requireUser(req, res, db);
  if (!actor) return;

  if (req.method === "POST" && url.pathname === "/api/listings") {
    const title = clean(body.title, 100);
    const description = clean(body.description, 3000);
    const delivery = clean(body.delivery, 2000);
    const anonymous = Boolean(body.anonymous);
    if (!title || !description || !delivery || !categories.includes(body.category)) return sendJson(res, 400, { error: "Complete all listing fields." });
    const review = reviewListingInput({ title, description, delivery });
    const needsReview = review.startsWith("Needs review");
    const listing = {
      id: id(),
      sellerId: actor.id,
      title,
      category: body.category,
      price: Math.max(1, number(body.price)),
      coin: ["SOL", "BTC", "LTC", "ETH"].includes(body.coin) ? body.coin : "SOL",
      kind: clean(body.kind, 40),
      anonymous,
      anonymousFeePaid: !anonymous,
      deliveryWindow: clean(body.deliveryWindow, 80) || "Seller will confirm timing.",
      description,
      delivery,
      status: needsReview || anonymous ? "pending" : "active",
      moderation: needsReview ? "needs_review" : "approved",
      reviewReason: review,
      reportCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.listings.unshift(listing);
    log(db, actor.id, "listing.create", `${actor.username} created listing "${title}".`, { listingId: listing.id, anonymous });
    notify(db, "admin", anonymous ? "Anonymous listing fee due" : "New listing", `${actor.username} submitted "${title}".`, "listing");
    if (anonymous) {
      db.payments.unshift({ id: id(), type: "anonymous_fee", listingId: listing.id, userId: actor.id, amount: 50, coin: listing.coin, wallet: escrowWallets[listing.coin], status: "unpaid", txid: "", createdAt: today(), updatedAt: today() });
      notify(db, actor.id, "Anonymous fee required", `Send $50 in ${listing.coin} to activate anonymous listing "${title}".`, "payment");
    }
    writeDb(db);
    return sendJson(res, 201, { listing: publicListing(db, listing, actor), message: anonymous ? "Listing saved. Pay the $50 anonymous fee from Payments/Admin simulation to activate it." : review });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    const listing = db.listings.find((l) => l.id === body.listingId);
    const seller = db.users.find((u) => u.id === listing?.sellerId);
    if (!listing || listing.status !== "active" || seller?.status === "banned") return sendJson(res, 404, { error: "Listing is not active." });
    if (listing.sellerId === actor.id) return sendJson(res, 400, { error: "You cannot buy your own listing." });
    const order = {
      id: id(),
      listingId: listing.id,
      buyerId: actor.id,
      sellerId: listing.sellerId,
      amount: listing.price,
      coin: listing.coin,
      wallet: escrowWallets[listing.coin],
      status: "unpaid",
      shippingInfo: clean(body.shippingInfo, 1000),
      createdAt: today(),
      updatedAt: today()
    };
    const payment = { id: id(), type: "order", orderId: order.id, userId: actor.id, amount: order.amount, coin: order.coin, wallet: order.wallet, status: "unpaid", txid: "", createdAt: today(), updatedAt: today() };
    db.orders.unshift(order);
    db.payments.unshift(payment);
    log(db, actor.id, "order.create", `${actor.username} opened order for "${listing.title}".`, { orderId: order.id });
    notify(db, actor.id, "Order created", `Send ${order.coin} payment to escrow wallet for "${listing.title}".`, "order");
    notify(db, order.sellerId, "New order", `${actor.username} started an order for "${listing.title}".`, "order");
    writeDb(db);
    return sendJson(res, 201, { order, payment });
  }

  if (req.method === "POST" && url.pathname === "/api/payments/submit") {
    const payment = db.payments.find((p) => p.id === body.paymentId);
    if (!payment || payment.userId !== actor.id) return sendJson(res, 404, { error: "Payment not found." });
    payment.txid = clean(body.txid, 180);
    payment.note = clean(body.note, 500);
    payment.status = "submitted";
    payment.updatedAt = today();
    if (payment.orderId) {
      const order = db.orders.find((o) => o.id === payment.orderId);
      order.status = "paid";
      order.updatedAt = today();
      notify(db, order.sellerId, "Payment submitted", "Buyer submitted a crypto transaction for admin review.", "payment");
    }
    log(db, actor.id, "payment.submit", `${actor.username} submitted transaction ${payment.txid || "(blank)"}.`, { paymentId: payment.id });
    notify(db, "admin", "Payment submitted", `${actor.username} submitted a crypto payment for review.`, "payment");
    writeDb(db);
    return sendJson(res, 200, { payment });
  }

  if (req.method === "POST" && url.pathname === "/api/orders/status") {
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order || !canAccessOrder(actor, order)) return sendJson(res, 404, { error: "Order not found." });
    const next = clean(body.status, 40);
    if (!["shipped", "delivered", "completed", "cancelled", "disputed"].includes(next)) return sendJson(res, 400, { error: "Unsupported user status." });
    if (next === "shipped" && order.sellerId !== actor.id) return sendJson(res, 403, { error: "Only seller can mark shipped." });
    if ((next === "delivered" || next === "completed") && order.buyerId !== actor.id) return sendJson(res, 403, { error: "Only buyer can confirm this." });
    order.status = next;
    order.updatedAt = today();
    log(db, actor.id, "order.status", `${actor.username} set order ${order.id.slice(0, 8)} to ${next}.`);
    notify(db, order.buyerId === actor.id ? order.sellerId : order.buyerId, "Order updated", `Order status changed to ${next}.`, "order");
    if (next === "completed") {
      notify(db, actor.id, "Contact escrow admin", "After confirming you received the goods or service, contact @v2zaso on Telegram so escrow can be reviewed and released.", "escrow");
      notify(db, "admin", "Buyer completed order", `${actor.username} completed order ${order.id.slice(0, 8)}. Watch for their Telegram message at @v2zaso.`, "escrow");
    }
    writeDb(db);
    return sendJson(res, 200, { order });
  }

  if (req.method === "POST" && url.pathname === "/api/disputes") {
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order || !canAccessOrder(actor, order)) return sendJson(res, 404, { error: "Order not found." });
    order.status = "disputed";
    const dispute = { id: id(), orderId: order.id, openedBy: actor.id, reason: clean(body.reason, 1000), status: "open", resolution: "", createdAt: today(), updatedAt: today() };
    db.disputes.unshift(dispute);
    log(db, actor.id, "dispute.open", `${actor.username} opened a dispute.`, { orderId: order.id });
    notify(db, "admin", "Dispute opened", `${actor.username} opened a dispute for order ${order.id.slice(0, 8)}.`, "dispute");
    writeDb(db);
    return sendJson(res, 201, { dispute });
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    const to = db.users.find((u) => u.id === body.toId || u.username === body.toUsername);
    if (!to) return sendJson(res, 404, { error: "Recipient not found." });
    const message = { id: id(), fromId: actor.id, toId: to.id, listingId: clean(body.listingId, 80), orderId: clean(body.orderId, 80), body: clean(body.body, 2000), createdAt: today(), read: false };
    if (!message.body) return sendJson(res, 400, { error: "Message cannot be empty." });
    db.messages.unshift(message);
    log(db, actor.id, "message.send", `${actor.username} messaged ${to.username}.`);
    notify(db, to.id, "New message", `${actor.username} sent you a message.`, "message");
    writeDb(db);
    return sendJson(res, 201, { message });
  }

  if (req.method === "POST" && url.pathname === "/api/favorites") {
    const listingId = clean(body.listingId, 80);
    const index = db.favorites.findIndex((f) => f.userId === actor.id && f.listingId === listingId);
    if (index >= 0) db.favorites.splice(index, 1);
    else db.favorites.push({ id: id(), userId: actor.id, listingId, createdAt: today() });
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/reports") {
    const report = { id: id(), reporterId: actor.id, targetType: clean(body.targetType, 40), targetId: clean(body.targetId, 80), reason: clean(body.reason, 1000), status: "open", createdAt: today(), updatedAt: today() };
    db.reports.unshift(report);
    const listing = db.listings.find((l) => l.id === report.targetId);
    if (listing) listing.reportCount += 1;
    log(db, actor.id, "report.create", `${actor.username} filed a report.`, report);
    notify(db, "admin", "Report filed", `${actor.username} reported ${report.targetType}.`, "report");
    writeDb(db);
    return sendJson(res, 201, { report });
  }

  if (req.method === "POST" && url.pathname === "/api/reviews") {
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order || order.buyerId !== actor.id || order.status !== "completed") return sendJson(res, 400, { error: "Only completed buyers can review." });
    const review = { id: id(), orderId: order.id, listingId: order.listingId, reviewerId: actor.id, sellerId: order.sellerId, rating: Math.min(5, Math.max(1, number(body.rating))), body: clean(body.body, 1000), createdAt: today() };
    db.reviews.unshift(review);
    log(db, actor.id, "review.create", `${actor.username} reviewed an order.`, { orderId: order.id });
    writeDb(db);
    return sendJson(res, 201, { review });
  }

  if (url.pathname.startsWith("/api/admin/")) return handleAdmin(req, res, db, actor, url, body);

  sendJson(res, 404, { error: "API route not found." });
}

function loginResponse(res, db, user) {
  const sessionId = id();
  const csrf = id();
  sessions.set(sessionId, user.id);
  csrfTokens.set(sessionId, csrf);
  return sendJson(res, 200, { currentUser: publicUser(user), csrfToken: csrf }, { "Set-Cookie": setCookie(res, sessionId) });
}

function handleAdmin(req, res, db, actor, url, body) {
  if (actor.role !== "admin") return sendJson(res, 403, { error: "Admin permission required." });

  if (req.method === "POST" && url.pathname === "/api/admin/users/status") {
    const target = db.users.find((u) => u.id === body.userId);
    if (!target || target.role === "admin") return sendJson(res, 400, { error: "User cannot be changed." });
    const status = clean(body.status, 30);
    if (!["active", "suspended", "banned"].includes(status)) return sendJson(res, 400, { error: "Bad status." });
    target.status = status;
    target.banReason = status === "banned" ? clean(body.reason, 500) || "Banned for marketplace policy violations." : "";
    if (status === "banned") {
      db.listings.filter((l) => l.sellerId === target.id).forEach((l) => { l.status = "inactive"; l.updatedAt = Date.now(); });
      for (const [sessionId, userId] of sessions) if (userId === target.id) sessions.delete(sessionId);
    }
    log(db, actor.id, `admin.user.${status}`, `${actor.username} set ${target.username} to ${status}.`, { reason: target.banReason });
    notify(db, target.id, "Account status updated", status === "banned" ? `Banned: ${target.banReason}` : `Your account is now ${status}.`, "admin");
    writeDb(db);
    return sendJson(res, 200, { user: adminUser(target) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/listings/update") {
    const listing = db.listings.find((l) => l.id === body.listingId);
    if (!listing) return sendJson(res, 404, { error: "Listing not found." });
    ["title", "description", "delivery", "category", "kind", "deliveryWindow"].forEach((key) => {
      if (body[key] !== undefined) listing[key] = clean(body[key], key === "description" || key === "delivery" ? 3000 : 120);
    });
    if (body.price !== undefined) listing.price = Math.max(1, number(body.price));
    if (body.status) listing.status = clean(body.status, 40);
    if (body.moderation) listing.moderation = clean(body.moderation, 40);
    listing.updatedAt = Date.now();
    log(db, actor.id, "admin.listing.update", `${actor.username} edited listing "${listing.title}".`, { listingId: listing.id });
    writeDb(db);
    return sendJson(res, 200, { listing: publicListing(db, listing, actor) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/listings/remove") {
    const listing = db.listings.find((l) => l.id === body.listingId);
    if (!listing) return sendJson(res, 404, { error: "Listing not found." });
    listing.status = "removed";
    listing.removalReason = clean(body.reason, 500) || "Removed by admin.";
    listing.updatedAt = Date.now();
    log(db, actor.id, "admin.listing.remove", `${actor.username} removed listing "${listing.title}".`, { listingId: listing.id });
    notify(db, listing.sellerId, "Listing removed", listing.removalReason, "admin");
    writeDb(db);
    return sendJson(res, 200, { listing });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/payments/status") {
    const payment = db.payments.find((p) => p.id === body.paymentId);
    if (!payment) return sendJson(res, 404, { error: "Payment not found." });
    const status = clean(body.status, 30);
    if (!["unpaid", "submitted", "confirmed", "refunded", "released"].includes(status)) return sendJson(res, 400, { error: "Bad payment status." });
    payment.status = status;
    payment.adminNote = clean(body.note, 500);
    payment.updatedAt = today();
    if (payment.type === "anonymous_fee" && status === "confirmed") {
      const listing = db.listings.find((l) => l.id === payment.listingId);
      if (listing) {
        listing.anonymousFeePaid = true;
        if (listing.moderation === "approved") listing.status = "active";
      }
    }
    if (payment.orderId) {
      const order = db.orders.find((o) => o.id === payment.orderId);
      if (order && status === "confirmed") order.status = "in_escrow";
      if (order && status === "refunded") order.status = "refunded";
      if (order && status === "released") order.status = "completed";
      if (order) order.updatedAt = today();
    }
    log(db, actor.id, "admin.payment.status", `${actor.username} set payment to ${status}.`, { paymentId: payment.id });
    notify(db, payment.userId, "Payment updated", `Admin marked your payment ${status}.`, "payment");
    writeDb(db);
    return sendJson(res, 200, { payment });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/orders/status") {
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order || !orderStatuses.includes(body.status)) return sendJson(res, 400, { error: "Order/status not found." });
    order.status = body.status;
    order.adminNote = clean(body.note, 500);
    order.updatedAt = today();
    log(db, actor.id, "admin.order.status", `${actor.username} set order to ${body.status}.`, { orderId: order.id });
    notify(db, order.buyerId, "Order updated by admin", `Order is now ${body.status}.`, "order");
    notify(db, order.sellerId, "Order updated by admin", `Order is now ${body.status}.`, "order");
    writeDb(db);
    return sendJson(res, 200, { order });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/disputes/resolve") {
    const dispute = db.disputes.find((d) => d.id === body.disputeId);
    if (!dispute) return sendJson(res, 404, { error: "Dispute not found." });
    const order = db.orders.find((o) => o.id === dispute.orderId);
    dispute.status = "resolved";
    dispute.resolution = clean(body.resolution, 1000);
    dispute.updatedAt = today();
    if (order && body.outcome === "refund") order.status = "refunded";
    if (order && body.outcome === "release") order.status = "completed";
    log(db, actor.id, "admin.dispute.resolve", `${actor.username} resolved a dispute.`, { disputeId: dispute.id, outcome: body.outcome });
    if (order) {
      notify(db, order.buyerId, "Dispute resolved", dispute.resolution, "dispute");
      notify(db, order.sellerId, "Dispute resolved", dispute.resolution, "dispute");
    }
    writeDb(db);
    return sendJson(res, 200, { dispute });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/reports/close") {
    const report = db.reports.find((r) => r.id === body.reportId);
    if (!report) return sendJson(res, 404, { error: "Report not found." });
    report.status = "closed";
    report.resolution = clean(body.resolution, 500);
    report.updatedAt = today();
    log(db, actor.id, "admin.report.close", `${actor.username} closed a report.`, { reportId: report.id });
    writeDb(db);
    return sendJson(res, 200, { report });
  }

  return sendJson(res, 404, { error: "Admin route not found." });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const target = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safe = path.normalize(target).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(root, safe);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    return res.end("Not found");
  }
  res.writeHead(200, securityHeaders({ "Content-Type": mime[path.extname(file)] || "application/octet-stream" }));
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!checkRate(req, res) || !checkCsrf(req, res)) return;
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error." });
  }
});

ensureData();
server.listen(port, host, () => {
  console.log(`VaultMarket running at http://${host}:${port}`);
  console.log(`Database file: ${dbFile}`);
});

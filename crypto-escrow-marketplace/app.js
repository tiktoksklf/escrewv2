const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = {
  currentUser: null,
  csrfToken: null,
  escrowWallets: {},
  categories: [],
  users: [],
  listings: [],
  orders: [],
  payments: [],
  disputes: [],
  messages: [],
  reviews: [],
  reports: [],
  notifications: [],
  favorites: [],
  admin: null,
  activeView: "home",
  activeCategory: "All",
  adminTab: "overview",
  activeThread: null
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(state.csrfToken ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...(options.headers || {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadState() {
  try {
    const data = await api("/api/state");
    state = { ...state, ...data };
    populatePostCategories();
    render();
  } catch (error) {
    toast(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function money(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function compact(value, max = 130) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function userById(id) {
  return state.users.find((user) => user.id === id) || { username: "Unknown", id };
}

function listingById(id) {
  return state.listings.find((listing) => listing.id === id) || state.admin?.listings.find((listing) => listing.id === id);
}

function isAdmin() {
  return state.currentUser?.role === "admin";
}

function requireLogin() {
  if (state.currentUser) return true;
  openAuth("login");
  return false;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

function setView(view) {
  state.activeView = view;
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populatePostCategories() {
  const select = $("#postForm select[name='category']");
  if (!select || select.children.length) return;
  select.innerHTML = state.categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("");
}

function render() {
  renderSession();
  renderWallet();
  renderKpis();
  renderCategories();
  renderListings();
  renderOrders();
  renderMessages();
  renderNotifications();
  renderAdmin();
}

function renderSession() {
  const host = $("#sessionActions");
  if (!state.currentUser) {
    host.innerHTML = `<button class="ghost" data-auth="login">Log in</button><button class="primary" data-auth="signup">Sign up</button>`;
    return;
  }
  host.innerHTML = `
    <button class="user-chip" data-profile="${state.currentUser.id}" type="button">
      <span class="avatar">${state.currentUser.username[0].toUpperCase()}</span>
      <strong>${escapeHtml(state.currentUser.username)}</strong>
      ${state.currentUser.role === "admin" ? '<span class="badge good">admin</span>' : ""}
    </button>
    <button class="ghost" id="logoutBtn" type="button">Log out</button>
  `;
}

function renderWallet() {
  const coin = $("#walletCoin").value || "SOL";
  $("#copyWallet").textContent = compact(state.escrowWallets[coin] || "Escrow wallet", 24);
}

function renderKpis() {
  const active = state.listings.filter((l) => l.status === "active").length;
  const escrow = state.orders.filter((o) => ["paid", "in_escrow", "shipped", "delivered", "disputed"].includes(o.status)).reduce((sum, order) => sum + Number(order.amount || 0), 0);
  $("#kpiListings").textContent = active;
  $("#kpiEscrow").textContent = money(escrow);
  $("#kpiDisputes").textContent = state.disputes.filter((d) => d.status === "open").length;
}

function renderCategories() {
  const tabs = ["All", ...state.categories].map((category) => `
    <button class="chip ${state.activeCategory === category ? "active" : ""}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>
  `).join("");
  $("#categoryTabs").innerHTML = tabs;
  $("#homeCategories").innerHTML = tabs;
}

function listingScore(query, listing) {
  if (!query) return 100;
  const hay = `${listing.title} ${listing.description} ${listing.category} ${listing.seller?.username}`.toLowerCase();
  const q = query.toLowerCase().trim();
  if (hay.includes(q)) return 200 - hay.indexOf(q);
  let score = 0;
  let pos = 0;
  for (const char of q) {
    const next = hay.indexOf(char, pos);
    if (next >= 0) {
      score += 8;
      pos = next + 1;
    }
  }
  return score;
}

function visibleListings() {
  const query = $("#searchInput").value;
  return state.listings
    .filter((listing) => listing.status === "active")
    .filter((listing) => state.activeCategory === "All" || listing.category === state.activeCategory)
    .map((listing) => ({ listing, score: listingScore(query, listing) }))
    .filter((entry) => !query || entry.score > 8)
    .sort((a, b) => b.score - a.score || b.listing.createdAt - a.listing.createdAt)
    .map((entry) => entry.listing);
}

function renderListings() {
  const cards = visibleListings();
  const html = cards.length ? cards.map(listingCard).join("") : emptyPanel("No matching active listings.");
  $("#listingGrid").innerHTML = html;
  $("#featuredGrid").innerHTML = cards.slice(0, 4).map(listingCard).join("") || emptyPanel("No active listings yet.");
}

function listingCard(listing) {
  const fav = state.favorites.some((f) => f.listingId === listing.id);
  const seller = listing.seller || {};
  return `
    <article class="card">
      <div class="thumb">${escapeHtml(listing.category.slice(0, 2).toUpperCase())}</div>
      <div class="card-body">
        <div class="listing-meta">
          <span class="badge">${escapeHtml(listing.category)}</span>
          <span class="badge ${listing.anonymous ? "warn" : "good"}">${listing.anonymous ? "anonymous" : "public seller"}</span>
          <span class="badge">${escapeHtml(listing.kind)}</span>
        </div>
        <h3>${escapeHtml(listing.title)}</h3>
        <p>${escapeHtml(compact(listing.description))}</p>
        <button class="seller-link" data-profile="${seller.id}" type="button">${escapeHtml(seller.username || "Seller")}${seller.status === "banned" ? " - banned" : ""}</button>
        <div class="price-row">
          <div><strong>${money(listing.price)}</strong><small>${escapeHtml(listing.coin)} escrow</small></div>
          <div class="button-row">
            <button class="icon-button ${fav ? "active" : ""}" data-favorite="${listing.id}" title="Favorite" type="button">★</button>
            <button class="primary" data-details="${listing.id}" type="button">View</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function emptyPanel(text) {
  return `<div class="panel empty">${escapeHtml(text)}</div>`;
}

function renderOrders() {
  const host = $("#ordersList");
  if (!state.currentUser) return host.innerHTML = emptyPanel("Log in to view orders.");
  host.innerHTML = state.orders.length ? state.orders.map(orderCard).join("") : emptyPanel("No orders yet.");
}

function orderCard(order) {
  const listing = listingById(order.listingId) || {};
  const payment = state.payments.find((p) => p.orderId === order.id);
  const buyer = userById(order.buyerId);
  const seller = userById(order.sellerId);
  const canBuyer = state.currentUser?.id === order.buyerId;
  const canSeller = state.currentUser?.id === order.sellerId;
  return `
    <article class="panel order-card">
      <div class="status-row">
        <span class="badge status">${escapeHtml(order.status)}</span>
        <strong>${escapeHtml(listing.title || "Listing")}</strong>
        <span>${money(order.amount)} ${escapeHtml(order.coin)}</span>
      </div>
      <p>Buyer: ${escapeHtml(buyer.username)} · Seller: ${escapeHtml(seller.username)} · Wallet: <code>${escapeHtml(compact(order.wallet, 38))}</code></p>
      ${payment ? `<p>Payment: ${escapeHtml(payment.status)} ${payment.txid ? `· tx ${escapeHtml(compact(payment.txid, 28))}` : ""}</p>` : ""}
      ${["delivered", "completed"].includes(order.status) && canBuyer ? `<p class="escrow-note">After confirming you received the goods or service, contact <strong>@v2zaso</strong> on Telegram so escrow can be reviewed and released.</p>` : ""}
      <div class="button-row">
        ${payment && canBuyer && payment.status !== "confirmed" ? `<button class="ghost" data-submit-payment="${payment.id}" type="button">Submit tx</button>` : ""}
        ${canSeller && ["in_escrow", "paid"].includes(order.status) ? `<button class="ghost" data-order-status="${order.id}:shipped" type="button">Mark shipped</button>` : ""}
        ${canBuyer && ["shipped", "in_escrow"].includes(order.status) ? `<button class="ghost" data-order-status="${order.id}:delivered" type="button">Confirm delivered</button>` : ""}
        ${canBuyer && order.status === "delivered" ? `<button class="primary" data-order-status="${order.id}:completed" type="button">Complete order</button>` : ""}
        ${["paid", "in_escrow", "shipped", "delivered"].includes(order.status) ? `<button class="danger" data-dispute="${order.id}" type="button">Open dispute</button>` : ""}
      </div>
    </article>
  `;
}

function renderMessages() {
  const list = $("#threadList");
  const detail = $("#threadDetail");
  if (!state.currentUser) {
    list.innerHTML = emptyPanel("Log in to message users.");
    detail.innerHTML = "";
    return;
  }
  const people = [...new Map(state.messages.map((m) => {
    const other = m.fromId === state.currentUser.id ? userById(m.toId) : userById(m.fromId);
    return [other.id, other];
  })).values()];
  list.innerHTML = people.length ? people.map((user) => `<button class="thread ${state.activeThread === user.id ? "active" : ""}" data-thread="${user.id}" type="button"><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.status || "active")}</small></button>`).join("") : emptyPanel("No conversations yet.");
  const target = state.activeThread ? userById(state.activeThread) : people[0];
  if (!target?.id) {
    detail.innerHTML = emptyPanel("Open a listing to start a message.");
    return;
  }
  state.activeThread = target.id;
  const messages = state.messages.filter((m) => m.fromId === target.id || m.toId === target.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  detail.innerHTML = `
    <h3>${escapeHtml(target.username)}</h3>
    <div class="message-stack">${messages.map((m) => `<div class="message ${m.fromId === state.currentUser.id ? "mine" : ""}"><span>${escapeHtml(userById(m.fromId).username)}</span><p>${escapeHtml(m.body)}</p></div>`).join("")}</div>
    <form class="inline-form" data-message-form="${target.id}">
      <input name="body" placeholder="Write a message..." required />
      <button class="primary" type="submit">Send</button>
    </form>
  `;
}

function renderNotifications() {
  const host = $("#notificationList");
  if (!state.currentUser) return host.innerHTML = emptyPanel("Log in to view notifications.");
  host.innerHTML = state.notifications.length ? state.notifications.map((n) => `
    <article class="panel feed-item">
      <span class="badge">${escapeHtml(n.type)}</span>
      <strong>${escapeHtml(n.title)}</strong>
      <p>${escapeHtml(n.body)}</p>
      <small>${new Date(n.createdAt).toLocaleString()}</small>
    </article>
  `).join("") : emptyPanel("No notifications.");
}

function renderProfile(userId) {
  const user = userById(userId);
  const listings = state.listings.filter((l) => l.seller?.id === userId || l.sellerId === userId);
  const reviews = state.reviews.filter((r) => r.sellerId === userId);
  const avg = reviews.length ? (reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length).toFixed(1) : "No";
  $("#profileHost").innerHTML = `
    <div class="profile panel">
      <div class="avatar big">${escapeHtml(user.username[0]?.toUpperCase() || "?")}</div>
      <div>
        <h2>${escapeHtml(user.username)}</h2>
        ${user.status === "banned" ? `<div class="ban-banner">Banned: ${escapeHtml(user.banReason || "Policy violation.")}</div>` : `<span class="badge good">${escapeHtml(user.status || "active")}</span>`}
        <p>${escapeHtml(user.publicBio || "Marketplace member.")}</p>
        <p>${avg} rating · ${reviews.length} reviews · joined ${new Date(user.joinedAt).toLocaleDateString()}</p>
      </div>
    </div>
    <div class="grid">${listings.map(listingCard).join("") || emptyPanel("No public active listings.")}</div>
  `;
  setView("profile");
}

function renderAdmin() {
  const tabs = ["overview", "users", "listings", "orders", "payments", "disputes", "messages", "reports", "logs"];
  $("#adminTabs").innerHTML = tabs.map((tab) => `<button class="chip ${state.adminTab === tab ? "active" : ""}" data-admin-tab="${tab}" type="button">${tab}</button>`).join("");
  const host = $("#adminPanel");
  if (!isAdmin() || !state.admin) return host.innerHTML = emptyPanel("Admin account required. Use zaso / owner.");
  const admin = state.admin;
  if (state.adminTab === "overview") {
    const escrow = admin.orders.filter((o) => ["paid", "in_escrow", "shipped", "delivered", "disputed"].includes(o.status)).reduce((sum, o) => sum + Number(o.amount), 0);
    host.innerHTML = `<div class="metrics"><div class="panel"><strong>${admin.users.length}</strong><span>users</span></div><div class="panel"><strong>${admin.listings.length}</strong><span>listings</span></div><div class="panel"><strong>${money(escrow)}</strong><span>escrow exposure</span></div><div class="panel"><strong>${admin.disputes.filter((d) => d.status === "open").length}</strong><span>open disputes</span></div></div>`;
  }
  if (state.adminTab === "users") host.innerHTML = admin.users.map(adminUserRow).join("");
  if (state.adminTab === "listings") host.innerHTML = admin.listings.map(adminListingRow).join("");
  if (state.adminTab === "orders") host.innerHTML = admin.orders.map(adminOrderRow).join("");
  if (state.adminTab === "payments") host.innerHTML = admin.payments.map(adminPaymentRow).join("");
  if (state.adminTab === "disputes") host.innerHTML = admin.disputes.map(adminDisputeRow).join("") || emptyPanel("No disputes.");
  if (state.adminTab === "messages") host.innerHTML = admin.messages.map((m) => `<article class="panel"><strong>${escapeHtml(userById(m.fromId).username)} → ${escapeHtml(userById(m.toId).username)}</strong><p>${escapeHtml(m.body)}</p><small>${new Date(m.createdAt).toLocaleString()}</small></article>`).join("") || emptyPanel("No messages.");
  if (state.adminTab === "reports") host.innerHTML = admin.reports.map((r) => `<article class="panel"><span class="badge">${escapeHtml(r.status)}</span><strong>${escapeHtml(r.targetType)}</strong><p>${escapeHtml(r.reason)}</p><button class="ghost" data-close-report="${r.id}" type="button">Close report</button></article>`).join("") || emptyPanel("No reports.");
  if (state.adminTab === "logs") host.innerHTML = admin.logs.map((log) => `<article class="log-row"><span>${new Date(log.createdAt).toLocaleString()}</span><strong>${escapeHtml(log.action)}</strong><p>${escapeHtml(log.detail)}</p></article>`).join("");
}

function adminUserRow(user) {
  return `
    <article class="panel admin-row">
      <div><strong>${escapeHtml(user.username)}</strong><p>${escapeHtml(user.email)} · ${escapeHtml(user.status)} ${user.banReason ? `· ${escapeHtml(user.banReason)}` : ""}</p></div>
      ${user.role === "admin" ? '<span class="badge good">admin</span>' : `<div class="button-row"><button class="ghost" data-user-status="${user.id}:suspended">Suspend</button><button class="ghost" data-user-status="${user.id}:active">Activate</button><button class="danger" data-user-status="${user.id}:banned">Ban</button></div>`}
    </article>
  `;
}

function adminListingRow(listing) {
  return `
    <article class="panel admin-row">
      <div><strong>${escapeHtml(listing.title)}</strong><p>${escapeHtml(listing.status)} · ${escapeHtml(listing.moderation)} · seller: ${escapeHtml(listing.seller?.username || "anonymous")} ${listing.canSeeOwner ? `(owner visible)` : ""}</p></div>
      <div class="button-row"><button class="ghost" data-edit-listing="${listing.id}">Edit</button><button class="ghost" data-activate-listing="${listing.id}">Activate</button><button class="danger" data-remove-listing="${listing.id}">Remove</button></div>
    </article>
  `;
}

function adminOrderRow(order) {
  return `
    <article class="panel admin-row">
      <div><strong>${escapeHtml(listingById(order.listingId)?.title || "Order")}</strong><p>${escapeHtml(order.status)} · ${money(order.amount)} ${escapeHtml(order.coin)} · buyer ${escapeHtml(userById(order.buyerId).username)} · seller ${escapeHtml(userById(order.sellerId).username)}</p></div>
      <select data-admin-order="${order.id}">${state.orderStatuses.map((s) => `<option ${s === order.status ? "selected" : ""}>${s}</option>`).join("")}</select>
    </article>
  `;
}

function adminPaymentRow(payment) {
  return `
    <article class="panel admin-row">
      <div><strong>${escapeHtml(payment.type)} payment</strong><p>${money(payment.amount)} ${escapeHtml(payment.coin)} · ${escapeHtml(payment.status)} · tx ${escapeHtml(payment.txid || "not submitted")}</p></div>
      <div class="button-row"><button class="ghost" data-payment-status="${payment.id}:confirmed">Confirm</button><button class="ghost" data-payment-status="${payment.id}:released">Release escrow</button><button class="danger" data-payment-status="${payment.id}:refunded">Refund</button></div>
    </article>
  `;
}

function adminDisputeRow(dispute) {
  return `
    <article class="panel admin-row">
      <div><strong>${escapeHtml(dispute.status)} dispute</strong><p>${escapeHtml(dispute.reason)} · order ${escapeHtml(dispute.orderId.slice(0, 8))}</p></div>
      <div class="button-row"><button class="ghost" data-resolve-dispute="${dispute.id}:release">Release to seller</button><button class="danger" data-resolve-dispute="${dispute.id}:refund">Refund buyer</button></div>
    </article>
  `;
}

function openAuth(mode) {
  state.authMode = mode;
  $("#authTitle").textContent = mode === "login" ? "Log in" : "Sign up";
  $("#authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  $("#swapAuth").textContent = mode === "login" ? "Need an account? Sign up" : "Have an account? Log in";
  $("#authForm [name='email']").parentElement.style.display = mode === "login" ? "none" : "grid";
  $("#authDialog").showModal();
}

function openDetails(id) {
  const listing = listingById(id);
  if (!listing) return;
  const seller = listing.seller || {};
  $("#detailsDialog").innerHTML = `
    <form method="dialog" class="modal-card large">
      <button class="icon-close" type="submit">×</button>
      <div class="listing-meta"><span class="badge">${escapeHtml(listing.category)}</span><span class="badge">${escapeHtml(listing.kind)}</span><span class="badge ${listing.anonymous ? "warn" : "good"}">${listing.anonymous ? "anonymous seller" : "public seller"}</span></div>
      <h2>${escapeHtml(listing.title)}</h2>
      <p>${escapeHtml(listing.description)}</p>
      <p><strong>${money(listing.price)} ${escapeHtml(listing.coin)}</strong> · ${escapeHtml(listing.deliveryWindow)}</p>
      <p>Seller: <button class="seller-link" data-profile="${seller.id}" type="button">${escapeHtml(seller.username || "Anonymous seller")}</button></p>
      <div class="button-row">
        <button class="primary" data-buy="${listing.id}" type="button">Buy with escrow</button>
        <button class="ghost" data-message-seller="${seller.id}" type="button">Message seller</button>
        <button class="ghost" data-report-listing="${listing.id}" type="button">Report</button>
      </div>
    </form>
  `;
  $("#detailsDialog").showModal();
}

function openAction(title, bodyHtml) {
  $("#actionDialog").innerHTML = `<form method="dialog" class="modal-card"><button class="icon-close" type="submit">×</button><h2>${escapeHtml(title)}</h2>${bodyHtml}</form>`;
  $("#actionDialog").showModal();
}

async function doAction(fn) {
  try {
    await fn();
    await loadState();
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.auth) openAuth(button.dataset.auth);
  if (button.id === "logoutBtn") doAction(() => api("/api/logout", { method: "POST" }));
  if (button.id === "swapAuth") openAuth(state.authMode === "login" ? "signup" : "login");
  if (button.id === "closeAuth") $("#authDialog").close();
  if (button.dataset.category) { state.activeCategory = button.dataset.category; render(); }
  if (button.dataset.details) openDetails(button.dataset.details);
  if (button.dataset.profile) renderProfile(button.dataset.profile);
  if (button.dataset.favorite && requireLogin()) doAction(() => api("/api/favorites", { method: "POST", body: { listingId: button.dataset.favorite } }));
  if (button.dataset.buy && requireLogin()) doAction(async () => {
    const order = await api("/api/orders", { method: "POST", body: { listingId: button.dataset.buy, shippingInfo: "" } });
    $("#detailsDialog").close();
    setView("orders");
    toast(`Order created. Send crypto to ${compact(order.payment.wallet, 30)}.`);
  });
  if (button.dataset.messageSeller && requireLogin()) {
    $("#detailsDialog").close();
    state.activeThread = button.dataset.messageSeller;
    setView("messages");
  }
  if (button.dataset.reportListing && requireLogin()) {
    const listingId = button.dataset.reportListing;
    openAction("Report listing", `<textarea name="reason" rows="4" required placeholder="Explain the issue"></textarea><button class="danger" data-confirm-report="${listingId}" type="button">Submit report</button>`);
  }
  if (button.dataset.confirmReport) doAction(() => api("/api/reports", { method: "POST", body: { targetType: "listing", targetId: button.dataset.confirmReport, reason: $("#actionDialog textarea").value } }).then(() => $("#actionDialog").close()));
  if (button.dataset.submitPayment) {
    const paymentId = button.dataset.submitPayment;
    openAction("Submit crypto transaction", `<input name="txid" required placeholder="Transaction hash / ID" /><textarea name="note" rows="3" placeholder="Optional note"></textarea><button class="primary" data-confirm-payment="${paymentId}" type="button">Submit</button>`);
  }
  if (button.dataset.confirmPayment) doAction(() => api("/api/payments/submit", { method: "POST", body: { paymentId: button.dataset.confirmPayment, txid: $("#actionDialog [name='txid']").value, note: $("#actionDialog [name='note']").value } }).then(() => $("#actionDialog").close()));
  if (button.dataset.orderStatus) {
    const [orderId, status] = button.dataset.orderStatus.split(":");
    doAction(async () => {
      await api("/api/orders/status", { method: "POST", body: { orderId, status } });
      if (status === "completed") toast("Now contact @v2zaso on Telegram so escrow can be reviewed and released.");
    });
  }
  if (button.dataset.dispute) {
    openAction("Open dispute", `<textarea name="reason" rows="4" required placeholder="Explain what happened"></textarea><button class="danger" data-confirm-dispute="${button.dataset.dispute}" type="button">Open dispute</button>`);
  }
  if (button.dataset.confirmDispute) doAction(() => api("/api/disputes", { method: "POST", body: { orderId: button.dataset.confirmDispute, reason: $("#actionDialog textarea").value } }).then(() => $("#actionDialog").close()));
  if (button.dataset.thread) { state.activeThread = button.dataset.thread; renderMessages(); }
  if (button.dataset.adminTab) { state.adminTab = button.dataset.adminTab; renderAdmin(); }
  if (button.dataset.userStatus) {
    const [userId, status] = button.dataset.userStatus.split(":");
    const reason = status === "banned" ? prompt("Public ban reason") : "";
    doAction(() => api("/api/admin/users/status", { method: "POST", body: { userId, status, reason } }));
  }
  if (button.dataset.removeListing) {
    const reason = prompt("Removal reason") || "Removed by admin.";
    doAction(() => api("/api/admin/listings/remove", { method: "POST", body: { listingId: button.dataset.removeListing, reason } }));
  }
  if (button.dataset.activateListing) doAction(() => api("/api/admin/listings/update", { method: "POST", body: { listingId: button.dataset.activateListing, status: "active", moderation: "approved" } }));
  if (button.dataset.editListing) {
    const listing = state.admin.listings.find((l) => l.id === button.dataset.editListing);
    openAction("Edit listing", `<input name="title" value="${escapeHtml(listing.title)}" /><input name="price" type="number" value="${listing.price}" /><textarea name="description" rows="5">${escapeHtml(listing.description)}</textarea><button class="primary" data-save-listing="${listing.id}" type="button">Save</button>`);
  }
  if (button.dataset.saveListing) doAction(() => api("/api/admin/listings/update", { method: "POST", body: { listingId: button.dataset.saveListing, title: $("#actionDialog [name='title']").value, price: $("#actionDialog [name='price']").value, description: $("#actionDialog textarea").value } }).then(() => $("#actionDialog").close()));
  if (button.dataset.paymentStatus) {
    const [paymentId, status] = button.dataset.paymentStatus.split(":");
    doAction(() => api("/api/admin/payments/status", { method: "POST", body: { paymentId, status, note: status } }));
  }
  if (button.dataset.resolveDispute) {
    const [disputeId, outcome] = button.dataset.resolveDispute.split(":");
    const resolution = prompt("Resolution note") || (outcome === "refund" ? "Refund issued after admin review." : "Escrow released after admin review.");
    doAction(() => api("/api/admin/disputes/resolve", { method: "POST", body: { disputeId, outcome, resolution } }));
  }
  if (button.dataset.closeReport) {
    const resolution = prompt("Report resolution") || "Reviewed and closed.";
    doAction(() => api("/api/admin/reports/close", { method: "POST", body: { reportId: button.dataset.closeReport, resolution } }));
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === "authForm") {
    const body = Object.fromEntries(new FormData(form));
    doAction(async () => {
      const data = await api(state.authMode === "login" ? "/api/login" : "/api/signup", { method: "POST", body });
      state.csrfToken = data.csrfToken;
      $("#authDialog").close();
      form.reset();
    });
  }
  if (form.id === "postForm") {
    if (!requireLogin()) return;
    const data = Object.fromEntries(new FormData(form));
    data.anonymous = form.anonymous.checked;
    doAction(async () => {
      const result = await api("/api/listings", { method: "POST", body: data });
      form.reset();
      setView("market");
      toast(result.message || "Listing submitted.");
    });
  }
  if (form.dataset.messageForm) {
    const body = form.body.value;
    const toId = form.dataset.messageForm;
    doAction(async () => {
      await api("/api/messages", { method: "POST", body: { toId, body } });
      form.reset();
    });
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "walletCoin") renderWallet();
  if (event.target.dataset.adminOrder) {
    doAction(() => api("/api/admin/orders/status", { method: "POST", body: { orderId: event.target.dataset.adminOrder, status: event.target.value } }));
  }
});

$("#searchInput").addEventListener("input", renderListings);
$("#copyWallet").addEventListener("click", async () => {
  const coin = $("#walletCoin").value;
  await navigator.clipboard?.writeText(state.escrowWallets[coin] || "");
  toast(`${coin} escrow wallet copied.`);
});

loadState();

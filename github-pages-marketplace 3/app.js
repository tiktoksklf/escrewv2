const SUPABASE_URL = "https://fnvmmdjjdwbhvpxwjgfd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_pxFy8QCmhOxEd7yJ-O0qKg_5t3aG1Pi";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const wallets = {
  SOL: "AE6vaxpfmPDtJNd1e5oboN5uZFqVYJMuwDyqykrCADvY",
  BTC: "bc1q4h9qnd5slacywkl87umlzxe9zxnpjjjzrjyed2",
  LTC: "LKhmv1GteaCj2eNREN9iMYdZNzbzDo2Gap",
  ETH: "0xb446020017eCb21F3ffE3DED59c770cFA0A1A96F"
};

const categories = ["All", "Development", "Design", "Marketing", "Writing", "Digital Goods", "Physical Goods"];
const state = { currentUser: null, profile: null, listings: [], orders: [] };
let activeView = "market";
let activeCategory = "All";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => `$${Number(value || 0).toLocaleString()}`;
const compact = (value, max = 28) => String(value || "").length > max ? `${String(value).slice(0, max - 5)}...${String(value).slice(-4)}` : String(value || "");

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}

function setBusy(form, busy) {
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = "Working...";
  } else {
    button.textContent = button.dataset.label || button.textContent;
  }
}

function setView(view) {
  activeView = view;
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  render();
}

function render() {
  renderSession();
  renderWallet();
  renderCategories();
  renderListings();
  renderForms();
  renderOrders();
  renderAdmin();
}

function renderSession() {
  const host = $("#sessionHost");
  if (!state.currentUser) {
    host.innerHTML = `<button class="ghost" data-view="account" type="button">Log in</button><button class="primary" data-view="account" type="button">Sign up</button>`;
    return;
  }
  const username = state.profile?.username || state.currentUser.email.split("@")[0];
  host.innerHTML = `<div class="user-chip"><span class="avatar">${escapeHtml(username[0].toUpperCase())}</span><strong>${escapeHtml(username)}</strong></div><button class="ghost" id="logoutBtn" type="button">Log out</button>`;
}

function renderWallet() {
  const coin = $("#walletCoin").value || "SOL";
  $("#copyWallet").textContent = compact(wallets[coin]);
}

function renderCategories() {
  $("#categoryTabs").innerHTML = categories.map((category) => `<button class="chip ${activeCategory === category ? "active" : ""}" data-category="${category}" type="button">${category}</button>`).join("");
}

function renderForms() {
  const select = $("#postForm select[name='category']");
  if (!select.children.length) select.innerHTML = categories.filter((category) => category !== "All").map((category) => `<option>${category}</option>`).join("");
}

function visibleListings() {
  const query = $("#searchInput").value.toLowerCase().trim();
  return state.listings.filter((listing) => activeCategory === "All" || listing.category === activeCategory)
    .filter((listing) => !query || `${listing.title} ${listing.description} ${listing.category} ${listing.seller_username}`.toLowerCase().includes(query));
}

function renderListings() {
  const listings = visibleListings();
  $("#listingGrid").innerHTML = listings.length ? listings.map((listing) => `
    <article class="card">
      <div class="listing-art">${escapeHtml(listing.category.slice(0, 2).toUpperCase())}</div>
      <div class="card-body">
        <div class="listing-meta"><span class="badge green">${escapeHtml(listing.category)}</span><span class="badge blue">${escapeHtml(listing.coin)}</span><span class="badge">${escapeHtml(listing.kind)}</span></div>
        <h3>${escapeHtml(listing.title)}</h3><p>${escapeHtml(listing.description)}</p>
        <small>Seller: ${listing.anonymous ? "Anonymous" : escapeHtml(listing.seller_username)} · ${escapeHtml(listing.delivery_window)}</small>
        <div class="price-row"><div><strong>${money(listing.price)}</strong><small>${escapeHtml(listing.coin)} escrow</small></div><button class="ghost" data-details="${listing.id}" type="button">View</button></div>
      </div>
    </article>`).join("") : `<div class="feed-item">No listings match this search.</div>`;
}

function renderOrders() {
  $("#ordersList").innerHTML = state.orders.length ? state.orders.map((order) => `
    <article class="feed-item"><span class="badge green">${escapeHtml(order.status)}</span><h3>${escapeHtml(order.listing_title)}</h3><p>${money(order.price)} ${escapeHtml(order.coin)} · send payment to <code>${escapeHtml(order.wallet)}</code></p></article>
  `).join("") : `<article class="feed-item"><h3>No orders yet</h3><p class="muted">Buy a listing to create an order.</p></article>`;
}

function renderAdmin() {
  $("#adminGrid").innerHTML = `<div class="admin-tile"><span class="badge blue">${state.listings.length}</span><h3>Live listings</h3><p class="muted">Shared through Supabase.</p></div><div class="admin-tile"><span class="badge green">Connected</span><h3>Database</h3><p class="muted">Accounts and posts are public-ready.</p></div>`;
}

function openListing(id) {
  const listing = state.listings.find((item) => item.id === id);
  if (!listing) return;
  $("#listingDialog").innerHTML = `<form class="modal-card" method="dialog"><div class="listing-meta"><span class="badge green">${escapeHtml(listing.category)}</span><span class="badge blue">${escapeHtml(listing.coin)}</span><span class="badge">${escapeHtml(listing.kind)}</span></div><h2>${escapeHtml(listing.title)}</h2><p>${escapeHtml(listing.description)}</p><p class="muted">Seller: ${listing.anonymous ? "Anonymous" : escapeHtml(listing.seller_username)} · delivery ${escapeHtml(listing.delivery_window)}</p><p><strong>${money(listing.price)} ${escapeHtml(listing.coin)}</strong> · escrow wallet <code>${escapeHtml(wallets[listing.coin])}</code></p><div class="modal-actions"><button class="primary" data-buy-listing="${listing.id}" type="button">Buy</button><button class="ghost" data-close-modal type="button">Close</button></div></form>`;
  $("#listingDialog").showModal();
}

function requireUser() {
  if (state.currentUser) return true;
  setView("account");
  toast("Create an account or log in first.");
  return false;
}

async function loadProfile() {
  state.profile = null;
  if (!state.currentUser) return;
  const { data } = await db.from("profiles").select("id, username, role").eq("id", state.currentUser.id).maybeSingle();
  state.profile = data;
}

async function loadListings() {
  const { data, error } = await db.rpc("get_public_listings");
  if (error) return toast("Finish the Supabase setup first.");
  state.listings = data || [];
  render();
}

async function loadOrders() {
  if (!state.currentUser) {
    state.orders = [];
    return;
  }
  const { data } = await db.from("orders").select("*").order("created_at", { ascending: false });
  state.orders = data || [];
}

async function refreshSession(session) {
  state.currentUser = session?.user || null;
  await loadProfile();
  await loadOrders();
  render();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.category) { activeCategory = button.dataset.category; render(); }
  if (button.dataset.details) openListing(button.dataset.details);
  if (button.dataset.closeModal !== undefined) $("#listingDialog").close();

  if (button.dataset.buyListing) {
    if (!requireUser()) return;
    const listing = state.listings.find((item) => item.id === button.dataset.buyListing);
    if (!listing) return;
    button.disabled = true;
    const { error } = await db.rpc("create_market_order", { p_listing_id: listing.id });
    button.disabled = false;
    if (error) return toast(error.message);
    await loadOrders();
    $("#listingDialog").close();
    setView("orders");
    toast("Order created.");
  }

  if (button.id === "logoutBtn") {
    await db.auth.signOut();
    toast("Logged out.");
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  setBusy(form, true);

  if (form.id === "signupForm") {
    const username = data.username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const { data: result, error } = await db.auth.signUp({ email: data.email, password: data.password, options: { data: { username } } });
    setBusy(form, false);
    if (error) return toast(error.message);
    form.reset();
    if (result.session) { setView("market"); toast("Account created."); }
    else toast("Check your email to confirm your account.");
    return;
  }

  if (form.id === "loginForm") {
    const { error } = await db.auth.signInWithPassword({ email: data.email, password: data.password });
    setBusy(form, false);
    if (error) return toast("Wrong email or password.");
    form.reset();
    setView("market");
    toast("Logged in.");
    return;
  }

  if (form.id === "postForm") {
    if (!requireUser()) { setBusy(form, false); return; }
    const username = state.profile?.username || state.currentUser.email.split("@")[0];
    const { error } = await db.from("listings").insert({
      seller_id: state.currentUser.id, seller_username: username, title: data.title,
      category: data.category, price: Number(data.price), coin: data.coin, kind: data.kind,
      anonymous: Boolean(data.anonymous), description: data.description,
      delivery_notes: data.delivery, delivery_window: data.deliveryWindow
    });
    setBusy(form, false);
    if (error) return toast(error.message);
    form.reset();
    await loadListings();
    setView("market");
    toast("Listing published for everyone.");
  }
});

$("#searchInput").addEventListener("input", renderListings);
$("#walletCoin").addEventListener("change", renderWallet);
$("#copyWallet").addEventListener("click", async () => {
  const coin = $("#walletCoin").value;
  await navigator.clipboard?.writeText(wallets[coin]);
  toast(`${coin} wallet copied.`);
});

db.auth.onAuthStateChange((_event, session) => setTimeout(() => refreshSession(session), 0));
render();
loadListings();

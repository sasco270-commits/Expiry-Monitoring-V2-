/* SASCO PALM - Firebase/GitHub Weekly Expiry replacement
   Keeps the original HTML layout and replaces the Weekly Expiry Google Apps Script
   data boundary with Firebase Realtime Database.

   Firebase project: expiry-monitoring-v2
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDXtkoz1xSpsWYuMV-wvm57TF0ajj0p9M9",
  authDomain: "expiry-monitoring-v2.firebaseapp.com",
  projectId: "expiry-monitoring-v2",
  storageBucket: "expiry-monitoring-v2.firebasestorage.app",
  messagingSenderId: "722745088244",
  appId: "1:722745088244:web:17a4f2854a98ee6f6366a1",
  measurementId: "G-YPXSVPRK36",
  databaseURL: "https://expiry-monitoring-v2-default-rtdb.firebaseio.com"
};

const ADMIN_EMAIL = "sasco270@gmail.com";

const DEFAULT_MIN_QTY = {
  "Confectionery & Sweet Snacks": {B:180,C:80,A:220,D:50,Z:20,HR:60,MT:60,X:40},
  "Grocery - Food & Grocery - Non Food": {B:80,C:60,A:100,D:40,Z:5,HR:30,MT:30,X:40},
  "Beverages & Dairy & Salty Snacks & Frozen": {B:180,C:150,A:200,D:30,Z:30,HR:40,MT:40,X:60}
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let firebaseUser = null;
let storesCache = {};
let empCache = [];
let dataCache = null;
let lookupCache = {};
let activeCycle = null;
let minQtyCache = {};
let settingsCache = {};
let firebaseReady = false;
let authReadyResolve;
const firebaseReadyPromise = new Promise(resolve => { authReadyResolve = resolve; });

const state = {
  store: null,
  employee: null,
  category: "",
  submitted: false,
  submission: null
};

function clean(v) {
  return String(v ?? "").trim();
}
function norm(v) {
  return clean(v).toLowerCase();
}
function safeKey(v) {
  return clean(v).replace(/[.#$[\]\/]/g, "_");
}
function esc(v) {
  return clean(v).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function toast(message, type="info") {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
  } else {
    console.log(`[${type}] ${message}`);
  }
}
function errorMessage(e) {
  return e?.message || String(e || "Unknown error");
}
function dateOnly(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseDDMMYYYY(value) {
  const s = clean(value);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
  if (d.getFullYear() !== Number(m[3]) ||
      d.getMonth() !== Number(m[2])-1 ||
      d.getDate() !== Number(m[1])) return null;
  return d;
}
function formatDDMMYYYY(d) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function normalizeDate(value) {
  const d = parseDDMMYYYY(value);
  if (d) return formatDDMMYYYY(d);
  const s = clean(value);
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const x = new Date(Number(iso[1]), Number(iso[2])-1, Number(iso[3]));
    if (!isNaN(x)) return formatDDMMYYYY(x);
  }
  return "";
}
function daysLeft(value) {
  const d = parseDDMMYYYY(value);
  if (!d) return "";
  const t = dateOnly();
  return Math.round((d - t) / 86400000);
}
function expiryStatus(value) {
  const n = Number(daysLeft(value));
  if (!Number.isFinite(n)) return "";
  if (n < 0) return "Expired";
  if (n <= 7) return "Critical";
  if (n <= 14) return "High";
  if (n <= 30) return "Near";
  return "OK";
}
function validateExpiry(value) {
  const d = parseDDMMYYYY(value);
  if (!d) return {valid:false, message:"Invalid expiry date format. Use DD/MM/YYYY."};
  const today = dateOnly();
  const min = new Date(today);
  min.setDate(min.getDate() - 21);
  const max = new Date(2035,11,31);
  if (d < min) {
    return {valid:false, message:`Expiry date cannot be older than 21 days. Earliest allowed date is ${formatDDMMYYYY(min)}.`};
  }
  if (d > max) return {valid:false, message:"Expiry date cannot be after 31/12/2035."};
  return {valid:true, date:d};
}
function cycleKey(cycle) {
  return safeKey(cycle?.startDate || cycle?.start || "current");
}
function categoryKey(category) {
  return safeKey(category);
}
function getEl(id) {
  return document.getElementById(id);
}
function setText(id, value) {
  const el = getEl(id);
  if (el) el.textContent = value ?? "";
}

async function ensureAnonymousAuth() {
  if (firebaseUser) return firebaseUser;
  if (auth.currentUser) {
    firebaseUser = auth.currentUser;
    if (!firebaseReady) {
      firebaseReady = true;
      authReadyResolve(firebaseUser);
    }
    return firebaseUser;
  }
  const result = await signInAnonymously(auth);
  firebaseUser = result.user;
  if (!firebaseReady) {
    firebaseReady = true;
    authReadyResolve(firebaseUser);
  }
  return firebaseUser;
}

onAuthStateChanged(auth, user => {
  firebaseUser = user || null;
  if (user && !firebaseReady) {
    firebaseReady = true;
    authReadyResolve(user);
  }
});

async function dbGet(path) {
  await firebaseReadyPromise;
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}
async function dbSet(path, value) {
  await firebaseReadyPromise;
  return set(ref(db, path), value);
}
async function dbUpdate(path, value) {
  await firebaseReadyPromise;
  return update(ref(db, path), value);
}
async function dbRemove(path) {
  await firebaseReadyPromise;
  return remove(ref(db, path));
}

function normalizeStore(raw, key="") {
  raw = raw || {};
  const code = clean(raw.code || raw.storeCode || raw.StoreCode || key);
  return {
    code,
    name: clean(raw.name || raw.storeName || raw.StoreName || raw.palmStore || code),
    classification: clean(raw.classification || raw.Classification || "C").toUpperCase(),
    areaManager: clean(raw.areaManager || raw.AreaManager),
    operationManager: clean(raw.operationManager || raw.OperationManager || raw.opsManager),
    region: clean(raw.region || raw.Region),
    location: clean(raw.location || raw.Location),
    storeType: clean(raw.storeType || raw.StoreType),
    email: clean(raw.email || raw.Email),
    promotionStore: raw.promotionStore ?? raw.PromotionStore ?? "",
    isPromotionStore: raw.isPromotionStore === true || /^(yes|y|true|1|promo|promotion|active)$/i.test(clean(raw.isPromotionStore || raw.promotionStore))
  };
}
function normalizeStores(raw) {
  const out = {};
  if (!raw) return out;
  if (Array.isArray(raw)) {
    raw.forEach((x,i) => {
      const s = normalizeStore(x, clean(x?.storeCode || x?.code || i));
      if (s.code) out[s.code] = s;
    });
  } else {
    Object.entries(raw).forEach(([k,v]) => {
      if (k === "headers") return;
      const s = normalizeStore(v,k);
      if (s.code) out[s.code] = s;
    });
  }
  return out;
}
function normalizeEmployee(raw, headers=[]) {
  if (Array.isArray(raw)) {
    const get = name => {
      const i = headers.findIndex(h => norm(h) === norm(name));
      return i >= 0 ? raw[i] : "";
    };
    return {
      employeeId: clean(get("Employee ID")),
      employeeName: clean(get("Employee Name")),
      storeCode: clean(get("Store Code")),
      status: clean(get("Status"))
    };
  }
  return {
    employeeId: clean(raw?.employeeId || raw?.EmployeeID || raw?.["Employee ID"] || raw?.EmpID),
    employeeName: clean(raw?.employeeName || raw?.EmployeeName || raw?.["Employee Name"] || raw?.name),
    storeCode: clean(raw?.storeCode || raw?.StoreCode || raw?.["Store Code"] || raw?.store),
    status: clean(raw?.status || raw?.Status || raw?.["Employee Status"])
  };
}
function normalizeEmployees(raw) {
  if (!raw) return [];
  const headers = Array.isArray(raw?.headers) ? raw.headers.map(clean) : [];
  let source = raw;
  if (raw?.rows) source = raw.rows;
  if (Array.isArray(source)) return source.map(x => normalizeEmployee(x, headers)).filter(x => x.employeeId);
  return Object.entries(source).filter(([k]) => k !== "headers" && k !== "rows")
    .map(([k,v]) => {
      const e = normalizeEmployee(v, headers);
      if (!e.employeeId) e.employeeId = clean(k);
      return e;
    }).filter(x => x.employeeId);
}
function employeeIsActive(status) {
  const s = norm(status);
  if (!s) return true;
  return !["inactive","terminated","terminated/inactive","disabled","false","no","left","resigned"].includes(s);
}

function normalizeProduct(raw, headers=[]) {
  if (Array.isArray(raw)) {
    const val = header => {
      const i = headers.findIndex(h => norm(h) === norm(header));
      return i >= 0 ? raw[i] : "";
    };
    return {
      sku: clean(val("SKU")),
      barcode: clean(val("Barcodes") || val("Barcode")),
      uom: clean(val("UOM") || "PCS"),
      description: clean(val("EN Desc") || val("Description")),
      cost: Number(String(val("Cost") || "0").replace(/,/g,"")) || 0,
      supplier: clean(val("Default Supplier") || val("Supplier")),
      vendorCode: clean(val("Vendor Code")),
      category: clean(val("Category")),
      nonReturnable: clean(val("Non - Returnable & Returnable") || "No"),
      source: "Data"
    };
  }
  return {
    sku: clean(raw?.sku || raw?.SKU),
    barcode: clean(raw?.barcode || raw?.Barcode || raw?.Barcodes),
    uom: clean(raw?.uom || raw?.UOM || "PCS"),
    description: clean(raw?.description || raw?.["EN Desc"] || raw?.Description),
    cost: Number(raw?.cost ?? raw?.Cost ?? 0) || 0,
    supplier: clean(raw?.supplier || raw?.Supplier || raw?.["Default Supplier"]),
    vendorCode: clean(raw?.vendorCode || raw?.["Vendor Code"]),
    category: clean(raw?.category || raw?.Category),
    nonReturnable: clean(raw?.nonReturnable || raw?.["Non - Returnable & Returnable"] || "No"),
    source: raw?.source || "Data"
  };
}
function normalizeProducts(raw) {
  if (!raw) return [];
  const headers = Array.isArray(raw?.headers) ? raw.headers.map(clean) : [];
  if (raw?.items) return normalizeProducts(raw.items);
  if (raw?.rows) return normalizeProducts({headers, data:raw.rows});
  if (raw?.data) {
    const rows = raw.data;
    if (Array.isArray(rows)) return rows.map(x => normalizeProduct(x,headers)).filter(p => p.sku || p.barcode);
  }
  if (Array.isArray(raw)) return raw.map(x => normalizeProduct(x,headers)).filter(p => p.sku || p.barcode);
  return Object.entries(raw).filter(([k]) => k !== "headers" && k !== "items")
    .map(([k,v]) => {
      const p = normalizeProduct(v,headers);
      if (!p.sku && !p.barcode) p.sku = clean(k);
      return p;
    }).filter(p => p.sku || p.barcode);
}

async function loadMasters() {
  await ensureAnonymousAuth();
  const [stores, employees, categories, cycles, minQty, settings] = await Promise.all([
    dbGet("storeMaster"),
    dbGet("EmpData"),
    dbGet("categories"),
    dbGet("categoryCycle"),
    dbGet("minQty"),
    dbGet("settings")
  ]);
  storesCache = normalizeStores(stores);
  empCache = normalizeEmployees(employees);
  minQtyCache = minQty || {};
  settingsCache = settings || {};
  activeCycle = findActiveCycle(cycles);
  window.firebaseStoresCache = storesCache;
  window.firebaseEmployeesCache = empCache;
  window.firebaseActiveCycle = activeCycle;
  window.firebaseCategoriesCache = categories || {};
  return {stores:storesCache,employees:empCache,cycle:activeCycle};
}
function findActiveCycle(raw) {
  const rows = [];
  if (Array.isArray(raw)) rows.push(...raw);
  else if (raw && Array.isArray(raw.rows)) rows.push(...raw.rows);
  else if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([k,v]) => {
      if (k === "headers") return;
      if (Array.isArray(v)) rows.push({sno:k, category:v[1], start:v[2], end:v[3]});
      else rows.push({...v, id:v?.id || k});
    });
  }
  const today = dateOnly();
  const active = rows.map((r,i) => ({
    category: clean(r.category || r.Category || r.name),
    startDate: normalizeCycleDate(r.startDate || r.start || r.Start || (Array.isArray(r) ? r[2] : "")),
    endDate: normalizeCycleDate(r.endDate || r.end || r.End || (Array.isArray(r) ? r[3] : "")),
    id: clean(r.id || r.cycleId || r.sno || i)
  })).filter(r => r.category && r.startDate && r.endDate)
    .find(r => {
      const s = new Date(r.startDate+"T00:00:00");
      const e = new Date(r.endDate+"T23:59:59");
      return today >= s && today <= e;
    });
  return active || null;
}
function normalizeCycleDate(v) {
  const s = clean(v);
  if (!s) return "";
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return s.slice(0,10);
  const d = parseDDMMYYYY(s);
  return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "";
}
function currentCategory() {
  return activeCycle?.category || "";
}

function findEmployee(employeeId) {
  const id = norm(employeeId);
  return empCache.find(e => norm(e.employeeId) === id) || null;
}
function validateEmployeeForStore(employeeId, storeCode) {
  const emp = findEmployee(employeeId);
  if (!emp) return {ok:false, message:`Employee ID ${employeeId} was not found in EmpData.`};
  if (!employeeIsActive(emp.status)) {
    return {ok:false, message:`Employee ID ${employeeId} is not active in EmpData${emp.status ? ` (${emp.status})` : ""}.`};
  }
  const masterStore = clean(emp.storeCode);
  const assignmentStatus = !masterStore ? "NO MASTER STORE" :
    norm(masterStore) === norm(storeCode) ? "MATCHED" : "TRANSFER / TEMPORARY";
  return {ok:true, employee:emp, assignmentStatus, employeeMasterStore:masterStore, workingStore:storeCode};
}

function productFromLookup(raw) {
  if (!raw) return null;
  if (raw.product) raw = raw.product;
  return normalizeProduct(raw);
}
async function lookupProduct(code) {
  code = clean(code);
  if (!code) return null;
  const bKey = safeKey(code);
  try {
    const [b,s] = await Promise.all([
      dbGet(`dataLookup/byBarcode/${bKey}`),
      dbGet(`dataLookup/bySku/${bKey}`)
    ]);
    const hit = productFromLookup(b || s);
    if (hit) return hit;
  } catch (e) {
    console.warn("lookup index error", e);
  }
  if (!dataCache) {
    const raw = await dbGet("Data");
    dataCache = normalizeProducts(raw);
    dataCache.forEach(p => {
      if (p.barcode) lookupCache[`b:${p.barcode}`] = p;
      if (p.sku) lookupCache[`s:${p.sku}`] = p;
    });
  }
  return lookupCache[`b:${code}`] || lookupCache[`s:${code}`] || null;
}

function draftPath(storeCode, category) {
  return `expiryDrafts/${safeKey(storeCode)}/${categoryKey(category)}/${cycleKey(activeCycle)}`;
}
function submissionPath(storeCode, category) {
  return `storeSubmissions/${safeKey(storeCode)}/${categoryKey(category)}/${cycleKey(activeCycle)}`;
}

function minimumRequired(category, classification) {
  const c = clean(category);
  const cls = clean(classification || "C").toUpperCase();
  const node = minQtyCache?.[c];
  if (node && typeof node === "object") {
    const v = Number(node[cls]);
    if (Number.isFinite(v)) return v;
  }
  return Number(DEFAULT_MIN_QTY[c]?.[cls] ?? 50);
}
function uniquePositiveSkuCount(items) {
  const set = new Set();
  (items || []).forEach(p => {
    const key = clean(p.barcode || p.sku);
    if (key && Number(p.Qty || 0) > 0) set.add(key);
  });
  return set.size;
}
function decorateItems(items) {
  return (items || []).map(p => {
    const x = JSON.parse(JSON.stringify(p || {}));
    x.StoreCode = state.store?.code || "";
    x.AreaManager = state.store?.areaManager || "";
    x.OperationManager = state.store?.operationManager || "";
    x.Qty = Number(x.Qty || 0);
    x.cost = Number(x.cost || x.Cost || 0);
    x.TotalCost = Number((x.Qty * x.cost).toFixed(2));
    if (x.ExpiryDate) {
      x.ExpiryDate = normalizeDate(x.ExpiryDate);
      x.DaysLeft = daysLeft(x.ExpiryDate);
      x.Status = expiryStatus(x.ExpiryDate);
    }
    return x;
  });
}
function validateItems(items) {
  if (!Array.isArray(items) || !items.length) return {ok:false,message:"No expiry items were provided."};
  const seen = {};
  for (let i=0;i<items.length;i++) {
    const p = items[i] || {};
    const key = clean(p.barcode || p.sku);
    if (!key) return {ok:false,message:`Item ${i+1}: Barcode/SKU is required.`};
    const q = Number(p.Qty || 0);
    if (!Number.isFinite(q) || q < 0) return {ok:false,message:`Item ${i+1}: invalid quantity.`};
    const ev = validateExpiry(p.ExpiryDate || p.expiryDate);
    if (!ev.valid) return {ok:false,message:`Item ${i+1} (${key}): ${ev.message}`};
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 3) return {ok:false,message:`Barcode/SKU ${key} cannot have more than 3 expiry dates.`};
    if (clean(p.category) !== clean(state.category)) {
      return {ok:false,message:`Item ${key} belongs to "${p.category}", not the active category "${state.category}".`};
    }
  }
  return {ok:true};
}

function setSubmissionUI(submitted, meta=null) {
  state.submitted = !!submitted;
  state.submission = meta || null;
  const scan = getEl("barcodeInput");
  const save = getEl("saveBtn");
  const submit = getEl("weeklySubmitBtn");
  if (scan) scan.disabled = submitted;
  if (save) save.disabled = submitted;
  if (submit) submit.disabled = submitted;
  const banner = getEl("submissionStatusBanner");
  if (banner) {
    banner.className = "submission-status-banner " + (submitted ? "show submitted" : "");
    const text = getEl("submissionStatusText");
    const details = getEl("submissionStatusDetails");
    const date = getEl("submissionStatusDate");
    if (text) text.textContent = submitted ? "Already Submitted" : "";
    if (details) details.textContent = submitted ? `This Store + Category cycle is locked.` : "";
    if (date) date.textContent = submitted && meta?.submittedAt ? new Date(meta.submittedAt).toLocaleString() : "";
  }
}
async function refreshSubmissionStatus() {
  if (!state.store || !state.category || !activeCycle) return false;
  const value = await dbGet(submissionPath(state.store.code, state.category));
  setSubmissionUI(!!value, value);
  return !!value;
}

async function loadDraft() {
  if (!state.store || !state.category || !activeCycle || state.submitted) return;
  const raw = await dbGet(draftPath(state.store.code, state.category));
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (items.length && Array.isArray(window.scannedProducts)) {
    window.scannedProducts = decorateItems(items);
    if (typeof window.renderAllRows === "function") window.renderAllRows();
    if (typeof window.validateExistingExpiryDates === "function") window.validateExistingExpiryDates();
    if (typeof window.updateMinimumRequirementDisplay === "function") window.updateMinimumRequirementDisplay();
    if (typeof window.updateCurrentCount === "function") window.updateCurrentCount();
    setText("lastSaveTime", raw.savedAt ? new Date(raw.savedAt).toLocaleString() : "Never");
    if (typeof window.expirySetDraftCard === "function") {
      window.expirySetDraftCard({
        recordCount: items.length,
        savedQty: Number(raw.savedQty || 0),
        savedValue: Number(raw.savedValue || 0),
        lastSavedAt: raw.savedAt || "",
        backupVersions: 0
      }, "saved");
    }
    toast(`Loaded ${items.length} saved item(s) for Store ${state.store.code}.`, "success");
  } else {
    setText("lastSaveTime","Never");
  }
}

async function saveDraftFirebase() {
  if (state.submitted) {
    toast("This Store + Category cycle is already submitted.", "warning");
    return;
  }
  if (!state.store || !state.employee || !state.category || !activeCycle) {
    toast("Store, Employee and active Category are required.", "warning");
    return;
  }
  const items = decorateItems(window.scannedProducts || []);
  const valid = validateItems(items);
  if (!valid.ok) {
    toast(valid.message, "error");
    return;
  }
  const payload = {
    storeCode: state.store.code,
    storeName: state.store.name,
    areaManager: state.store.areaManager,
    operationManager: state.store.operationManager,
    classification: state.store.classification,
    employeeId: state.employee.employeeId,
    employeeName: state.employee.employeeName,
    category: state.category,
    cycleStart: activeCycle.startDate,
    cycleEnd: activeCycle.endDate,
    items,
    itemCount: items.length,
    savedQty: items.reduce((n,p)=>n+Number(p.Qty||0),0),
    savedValue: items.reduce((n,p)=>n+Number(p.TotalCost||0),0),
    savedAt: new Date().toISOString()
  };
  await dbSet(draftPath(state.store.code,state.category), payload);
  setText("lastSaveTime", new Date(payload.savedAt).toLocaleString());
  if (typeof window.expirySetDraftCard === "function") {
    window.expirySetDraftCard({
      recordCount:payload.itemCount,
      savedQty:payload.savedQty,
      savedValue:payload.savedValue,
      lastSavedAt:payload.savedAt,
      backupVersions:0
    },"saved");
  }
  toast("Weekly Expiry draft saved safely in Firebase.", "success");
}

async function submitFirebase() {
  if (state.submitted) {
    toast("This Store + Category cycle has already been submitted.", "warning");
    return;
  }
  if (!state.store || !state.employee || !state.category || !activeCycle) {
    toast("Store, Employee and active Category are required.", "warning");
    return;
  }
  const items = decorateItems(window.scannedProducts || []);
  const valid = validateItems(items);
  if (!valid.ok) {
    toast(valid.message, "error");
    return;
  }
  const required = minimumRequired(state.category, state.store.classification);
  const actual = uniquePositiveSkuCount(items);
  if (actual < required) {
    toast(`Minimum requirement not met: ${actual} / ${required} unique SKU(s).`, "error");
    return;
  }

  const payload = {
    storeCode: state.store.code,
    storeName: state.store.name,
    areaManager: state.store.areaManager,
    operationManager: state.store.operationManager,
    classification: state.store.classification,
    employeeId: state.employee.employeeId,
    employeeName: state.employee.employeeName,
    category: state.category,
    cycleStart: activeCycle.startDate,
    cycleEnd: activeCycle.endDate,
    submittedAt: new Date().toISOString(),
    itemCount: items.length,
    totalQty: items.reduce((n,p)=>n+Number(p.Qty||0),0),
    totalCost: items.reduce((n,p)=>n+Number(p.TotalCost||0),0),
    items
  };

  const target = ref(db, submissionPath(state.store.code,state.category));
  const tx = await runTransaction(target, current => current || payload);
  if (!tx.committed) {
    setSubmissionUI(true, tx.snapshot.val());
    toast("This Store + Category cycle was already submitted.", "warning");
    return;
  }
  state.submitted = true;
  setSubmissionUI(true, tx.snapshot.val());
  await dbRemove(draftPath(state.store.code,state.category));
  toast("Weekly Expiry submitted successfully to Firebase.", "success");
  downloadSubmissionCSV(payload);
}

function downloadSubmissionCSV(payload) {
  const headers = ["Date","Store","Store Code","Area Manager","Operation Manager","Emp ID","Category","SKU","Barcode","UOM","Desc","Cost","Supplier","Vendor Code","NonReturnable","Qty","Total Cost","Expiry","Days Left","Status"];
  const rows = [headers];
  payload.items.forEach(r => rows.push([
    payload.submittedAt,payload.storeName,payload.storeCode,payload.areaManager,payload.operationManager,
    payload.employeeId,payload.category,r.sku,r.barcode,r.uom,r.description,r.cost,r.supplier,r.vendorCode,
    r.nonReturnable,r.Qty,r.TotalCost,r.ExpiryDate,r.DaysLeft,r.Status
  ]));
  const csv = rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Weekly_Expiry_${payload.storeCode}_${payload.category}_${payload.cycleStart}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function firebaseValidateStore(code, silent=false) {
  code = clean(code);
  if (!code) return false;
  await loadMasters();
  const store = storesCache[code] || Object.values(storesCache).find(s => norm(s.code) === norm(code));
  const panel = getEl("expiryVerifiedStorePanel");
  const emp = getEl("expiryLoginEmployeeId");
  if (!store) {
    state.store = null;
    if (panel) panel.style.display = "none";
    if (emp) { emp.disabled = true; emp.value = ""; }
    if (!silent) toast("Store Code was not found in Firebase storeMaster.", "error");
    return false;
  }
  state.store = store;
  window.expiryVerifiedStore = store;
  setText("expiryVerifiedStoreName",store.name || "—");
  setText("expiryVerifiedStoreCode",store.code || "—");
  setText("expiryVerifiedStoreClass",store.classification || "—");
  setText("expiryVerifiedStoreAM",store.areaManager || "Not Assigned");
  setText("expiryVerifiedStoreOM",store.operationManager || "Not Assigned");
  if (panel) panel.style.display = "block";
  if (emp) { emp.disabled = false; if (!silent) emp.focus(); }
  if (!silent) toast(`Store verified: ${store.name || store.code}`, "success");
  return true;
}

async function firebaseLoginStore(code, employeeId) {
  await ensureAnonymousAuth();
  await loadMasters();
  const store = storesCache[clean(code)];
  if (!store) throw new Error("Store Code was not found in Firebase storeMaster.");
  if (!store.areaManager) throw new Error("This store has no Area Manager assigned in storeMaster.");
  const check = validateEmployeeForStore(employeeId, store.code);
  if (!check.ok) throw new Error(check.message);

  const session = {
    module:"WeeklyExpiry",
    role:"Store",
    storeCode:store.code,
    storeName:store.name,
    classification:store.classification,
    areaManager:store.areaManager,
    operationManager:store.operationManager,
    employeeId:check.employee.employeeId,
    employeeName:check.employee.employeeName,
    employeeStoreCode:check.employee.storeCode,
    workingStoreCode:store.code,
    assignmentStatus:check.assignmentStatus,
    employeeStatus:check.employee.status,
    employeeValidated:true,
    loginMethod:"StoreCode+EmpData",
    loginAt:new Date().toISOString()
  };
  await dbSet(`storeSessions/${firebaseUser.uid}`, session);
  state.store = store;
  state.employee = check.employee;
  state.category = currentCategory();
  if (!state.category) throw new Error("No active Category Cycle is configured for today.");
  await refreshSubmissionStatus();
  return session;
}

function updateWeeklyCategoryUI() {
  const dd = getEl("categoryDropdown");
  if (!dd) return;
  dd.innerHTML = "";
  const cat = currentCategory();
  if (!cat) {
    dd.innerHTML = '<option value="">No active category</option>';
    state.category = "";
    return;
  }
  dd.innerHTML = `<option value="${esc(cat)}">${esc(cat)}</option>`;
  dd.value = cat;
  state.category = cat;
  setText("currentCategory",cat);
  const req = minimumRequired(cat,state.store?.classification || "C");
  setText("requiredCount",String(req));
  setText("reqCount",String(req));
}

function overrideGlobal(name, fn) {
  window[name] = fn;
}

async function firebaseExpiryVerifyStore(silent=false) {
  const code = clean(getEl("expiryLoginStoreCode")?.value);
  if (!code) {
    if (!silent) toast("Enter Store Code.", "warning");
    return false;
  }
  const ok = await firebaseValidateStore(code,silent);
  return ok;
}

async function firebaseExpiryDoLogin() {
  const code = clean(getEl("expiryLoginStoreCode")?.value);
  const emp = clean(getEl("expiryLoginEmployeeId")?.value);
  if (!code) { toast("Enter Store Code.", "warning"); return; }
  if (!state.store || norm(state.store.code)!==norm(code)) {
    if (!(await firebaseValidateStore(code,false))) return;
  }
  if (!emp) { toast("Employee ID is required and must exist in EmpData.", "warning"); return; }
  const btn = getEl("expiryLoginBtn");
  if (btn) btn.disabled = true;
  try {
    const session = await firebaseLoginStore(code,emp);
    window.expiryToken = `firebase:${firebaseUser.uid}`;
    window.expirySession = session;
    sessionStorage.setItem("expiryToken",window.expiryToken);
    sessionStorage.setItem("expirySession",JSON.stringify(session));
    firebaseOpenWeeklySession();
    toast("Store + Employee verified · Weekly Expiry opened","success");
  } catch(e) {
    toast(errorMessage(e),"error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function firebaseOpenWeeklySession() {
  const page = getEl("weeklyExpiryPage");
  const login = getEl("weeklyExpiryLoginPage");
  const home = getEl("landingPage");
  if (home) home.style.display = "none";
  if (login) login.style.display = "none";
  if (page) page.style.display = "block";
  state.category = currentCategory();
  updateWeeklyCategoryUI();
  if (typeof window.expiryApplyIdentityToPage === "function") window.expiryApplyIdentityToPage();
  else {
    const s = window.expirySession || {};
    const storeInput=getEl("storeCodeInput"); if(storeInput) {storeInput.value=s.storeCode||"";storeInput.readOnly=true;}
    const empInput=getEl("empId"); if(empInput) {empInput.value=s.employeeId||"";empInput.readOnly=true;}
  }
  initializeFirebaseWeeklyExpiry().catch(e => toast(errorMessage(e),"error"));
}

async function initializeFirebaseWeeklyExpiry() {
  await ensureAnonymousAuth();
  await loadMasters();
  state.category = currentCategory();
  updateWeeklyCategoryUI();
  setText("weeklyExpiryDateRuleHint",`Earliest expiry: ${formatDDMMYYYY(new Date(dateOnly().getTime()-21*86400000))} · future dates allowed`);
  await refreshSubmissionStatus();
  if (!state.submitted) await loadDraft();
  if (typeof window.applyBarcodePasteBehavior === "function") {
    try { window.applyBarcodePasteBehavior(); } catch {}
  }
  const scan=getEl("barcodeInput");
  if(scan && !state.submitted) scan.focus();
}

async function firebaseHandleScan(code) {
  const cat = clean(getEl("categoryDropdown")?.value || state.category);
  if (!cat) { toast("No active category is available.","warning"); return; }
  if (!state.store) { toast("Please verify Store Code and Employee ID first.","warning"); return; }
  if (state.submitted) { toast("This Store + Category cycle has already been submitted.","warning"); return; }
  code = clean(code);
  if (!code) return;
  const products = Array.isArray(window.scannedProducts) ? window.scannedProducts : [];
  const sameCount = products.filter(p => clean(p.barcode || p.sku) === code).length;
  if (sameCount >= 3) {
    toast(`Maximum 3 expiry dates allowed for ${code}.`,"error");
    return;
  }
  try {
    const p = await lookupProduct(code);
    if (!p) {
      toast(`Item ${code} was not found in Firebase Data.`, "error");
      return;
    }
    if (clean(p.category) !== cat) {
      toast(`Item belongs to "${p.category}", not the active category "${cat}".`,"error");
      return;
    }
    if (typeof window.expiryRememberProduct === "function") window.expiryRememberProduct(p);
    if (typeof window.autoAddToTable === "function") {
      window.autoAddToTable(p);
    } else {
      const x = {...p,Qty:0,TotalCost:"0.00",ExpiryDate:"",DaysLeft:"",Status:"",StoreCode:state.store.code,
        AreaManager:state.store.areaManager,OperationManager:state.store.operationManager};
      products.push(x);
      window.scannedProducts = products;
      if (typeof window.renderAllRows === "function") window.renderAllRows();
    }
  } catch(e) {
    toast(`Product lookup failed: ${errorMessage(e)}`,"error");
  }
}

async function firebaseCategoryChanged() {
  state.category = clean(getEl("categoryDropdown")?.value);
  if (!state.category) return;
  await refreshSubmissionStatus();
  if (!state.submitted) await loadDraft();
  if (typeof window.updateMinimumRequirementDisplay === "function") window.updateMinimumRequirementDisplay();
}

function firebaseSaveData() { saveDraftFirebase().catch(e => toast(errorMessage(e),"error")); }
function firebaseSubmitData() { submitFirebase().catch(e => toast(errorMessage(e),"error")); }

function firebaseLoadSavedData() { loadDraft().catch(e => toast(errorMessage(e),"error")); }

function firebaseCheckStatus(storeCode) {
  return refreshSubmissionStatus().catch(e => {
    toast(`Submission status check failed: ${errorMessage(e)}`,"error");
    return false;
  });
}

function firebaseLogoutAndHome() {
  const uid = firebaseUser?.uid;
  if (uid) dbRemove(`storeSessions/${uid}`).catch(()=>{});
  state.store=null; state.employee=null; state.category="";
  sessionStorage.removeItem("expiryToken");
  sessionStorage.removeItem("expirySession");
  signOut(auth).catch(()=>{});
  if (typeof window.resetItemCompletionState === "function") window.resetItemCompletionState();
  if (typeof window.goBackToHome === "function") {
    // Avoid recursion: directly switch pages.
  }
  getEl("landingPage")?.style && (getEl("landingPage").style.display="block");
  getEl("weeklyExpiryLoginPage")?.style && (getEl("weeklyExpiryLoginPage").style.display="none");
  getEl("weeklyExpiryPage")?.style && (getEl("weeklyExpiryPage").style.display="none");
  toast("Weekly Expiry session closed","info");
}

function firebaseOpenWeeklyExpiryMonitoring() {
  const landing=getEl("landingPage");
  if (landing) landing.style.display="none";
  const page=getEl("weeklyExpiryPage"); if(page) page.style.display="none";
  const login=getEl("weeklyExpiryLoginPage"); if(login) login.style.display="block";
  const code=getEl("expiryLoginStoreCode");
  if (code) {
    code.disabled=false;
    code.focus();
  }
}

async function installFirebaseUIHooks() {
  await ensureAnonymousAuth();
  await loadMasters();

  overrideGlobal("validateStoreByCode", async code => {
    const ok = await firebaseValidateStore(clean(code),false);
    return ok ? {
      valid:true,storeCode:state.store.code,storeName:state.store.name,
      classification:state.store.classification,areaManager:state.store.areaManager,
      operationManager:state.store.operationManager,region:state.store.region,
      location:state.store.location,storeType:state.store.storeType,email:state.store.email
    } : {valid:false,storeCode:clean(code)};
  });
  overrideGlobal("expiryVerifyStore", firebaseExpiryVerifyStore);
  overrideGlobal("expiryDoLogin", firebaseExpiryDoLogin);
  overrideGlobal("openWeeklyExpiryMonitoring", firebaseOpenWeeklyExpiryMonitoring);
  overrideGlobal("expiryOpenWeeklySession", firebaseOpenWeeklySession);
  overrideGlobal("expiryTryResume", firebaseOpenWeeklyExpiryMonitoring);
  overrideGlobal("expiryLogoutAndHome", firebaseLogoutAndHome);
  overrideGlobal("initializeWeeklyExpiry", initializeFirebaseWeeklyExpiry);
  overrideGlobal("handleScan", firebaseHandleScan);
  overrideGlobal("saveData", firebaseSaveData);
  overrideGlobal("submitData", firebaseSubmitData);
  overrideGlobal("loadSavedData", firebaseLoadSavedData);
  overrideGlobal("checkStoreSubmissionStatus", firebaseCheckStatus);
  overrideGlobal("onCategoryChange", firebaseCategoryChanged);
  overrideGlobal("loadCategoryCycleAndPopulate", async () => {
    await loadMasters();
    updateWeeklyCategoryUI();
  });
  overrideGlobal("getMinimumQuantityForCategory", minimumRequired);

  // Auto-verify Store Code on Enter/blur, matching the requested workflow.
  const storeInput=getEl("expiryLoginStoreCode");
  if (storeInput && !storeInput.dataset.firebaseBound) {
    storeInput.dataset.firebaseBound="1";
    storeInput.addEventListener("keydown", e => {
      if (e.key==="Enter") { e.preventDefault(); firebaseValidateStore(storeInput.value,false); }
    });
    storeInput.addEventListener("blur", () => {
      if (clean(storeInput.value)) firebaseValidateStore(storeInput.value,true);
    });
  }

  const cat=getEl("categoryDropdown");
  if (cat && !cat.dataset.firebaseBound) {
    cat.dataset.firebaseBound="1";
    cat.addEventListener("change", () => firebaseCategoryChanged());
  }

  // Barcode input: the original UI's scanner handler is retained, but its global
  // handleScan has been replaced above.
  const barcode=getEl("barcodeInput");
  if (barcode && !barcode.dataset.firebaseBound) {
    barcode.dataset.firebaseBound="1";
    barcode.addEventListener("keydown", e => {
      if (e.key==="Enter") {
        e.preventDefault();
        const v=barcode.value;
        barcode.value="";
        firebaseHandleScan(v);
      }
    });
  }

  // Replace the old password-only admin action with Firebase Auth while keeping
  // the original admin panel visual shell.
  overrideGlobal("verifyAdminPassword", firebaseAdminLogin);
  overrideGlobal("closeAdminPanel", () => {
    const p=getEl("adminPanel"); if(p) p.style.display="none";
  });
}

async function firebaseAdminLogin() {
  const pw=clean(getEl("adminPassword")?.value);
  if (!pw) { toast("Enter the Firebase Admin password.","warning"); return; }
  try {
    const cred=await signInWithEmailAndPassword(auth,ADMIN_EMAIL,pw);
    await dbSet(`admins/${cred.user.uid}`,true);
    buildFirebaseAdminPanel();
    const modal=getEl("pwModal"); if(modal) modal.style.display="none";
    const panel=getEl("adminPanel"); if(panel) panel.style.display="block";
    toast("Firebase Admin access granted.","success");
  } catch(e) {
    toast(`Firebase Admin login failed: ${errorMessage(e)}. Create/enable the ${ADMIN_EMAIL} Firebase Authentication user first.`,"error");
  }
}

function adminOnly() {
  if (!firebaseUser?.email || norm(firebaseUser.email)!==norm(ADMIN_EMAIL)) {
    throw new Error("Firebase Admin login is required.");
  }
}

async function adminGet(path) { adminOnly(); return dbGet(path); }
async function adminSet(path,value) { adminOnly(); return dbSet(path,value); }
async function adminRemove(path) { adminOnly(); return dbRemove(path); }

function buildFirebaseAdminPanel() {
  const panel=getEl("adminPanel");
  if (!panel || panel.dataset.firebaseBuilt) return;
  panel.dataset.firebaseBuilt="1";
  panel.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h3 style="font-size:20px;font-weight:700"><i class="fas fa-database" style="color:var(--primary)"></i> Firebase Admin Control Center</h3>
      <button class="btn btn-ghost" id="firebaseAdminClose"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="fadmMap">Mapping</button>
      <button class="admin-tab" data-tab="fadmStores">Stores</button>
      <button class="admin-tab" data-tab="fadmEmp">Employees</button>
      <button class="admin-tab" data-tab="fadmData">Data Master</button>
      <button class="admin-tab" data-tab="fadmCycle">Category Cycle</button>
      <button class="admin-tab" data-tab="fadmMin">Min Qty</button>
    </div>
    <div id="fadmMap" class="admin-tab-content"></div>
    <div id="fadmStores" class="admin-tab-content" style="display:none"></div>
    <div id="fadmEmp" class="admin-tab-content" style="display:none"></div>
    <div id="fadmData" class="admin-tab-content" style="display:none"></div>
    <div id="fadmCycle" class="admin-tab-content" style="display:none"></div>
    <div id="fadmMin" class="admin-tab-content" style="display:none"></div>`;
  getEl("firebaseAdminClose").onclick=()=>panel.style.display="none";
  panel.querySelectorAll(".admin-tab").forEach(btn=>{
    btn.onclick=()=>{
      panel.querySelectorAll(".admin-tab").forEach(b=>b.classList.remove("active"));
      panel.querySelectorAll(".admin-tab-content").forEach(x=>x.style.display="none");
      btn.classList.add("active");
      getEl(btn.dataset.tab).style.display="block";
      if(btn.dataset.tab==="fadmMap") renderAdminMapping();
      if(btn.dataset.tab==="fadmStores") renderAdminStores();
      if(btn.dataset.tab==="fadmEmp") renderAdminEmployees();
      if(btn.dataset.tab==="fadmData") renderAdminData();
      if(btn.dataset.tab==="fadmCycle") renderAdminCycle();
      if(btn.dataset.tab==="fadmMin") renderAdminMin();
    };
  });
  renderAdminMapping();
}

async function renderAdminMapping() {
  const el=getEl("fadmMap"); if(!el) return;
  const paths=["storeMaster","EmpData","Data","dataLookup","categories","categoryCycle","minQty","settings","storeSubmissions"];
  const out=[];
  for(const p of paths) {
    try {
      const v=await adminGet(p);
      let summary="empty";
      if (Array.isArray(v)) summary=`array (${v.length})`;
      else if (v && typeof v==="object") summary=`object (${Object.keys(v).length} keys)`;
      else if (v!=null) summary=typeof v;
      out.push(`<tr><td><b>${esc(p)}</b></td><td>${esc(summary)}</td></tr>`);
    } catch(e) { out.push(`<tr><td><b>${esc(p)}</b></td><td class="expired">${esc(errorMessage(e))}</td></tr>`); }
  }
  el.innerHTML=`<h4>Firebase Mapping</h4><p style="font-size:12px;color:var(--gray-500)">Live Firebase paths used by the GitHub Weekly Expiry app.</p>
  <div class="table-container"><table><thead><tr><th>Path</th><th>Mapping</th></tr></thead><tbody>${out.join("")}</tbody></table></div>`;
}

async function renderAdminStores() {
  const el=getEl("fadmStores"); if(!el) return;
  const stores=await adminGet("storeMaster") || {};
  storesCache=normalizeStores(stores);
  const rows=Object.values(storesCache).slice(0,500).map(s=>`<tr>
    <td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.classification)}</td><td>${esc(s.areaManager)}</td><td>${esc(s.operationManager)}</td>
    <td><button class="btn btn-xs btn-primary" data-edit-store="${esc(s.code)}">Edit</button></td></tr>`).join("");
  el.innerHTML=`<h4>Store Master</h4>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <input id="newStoreCode" placeholder="Store Code"><input id="newStoreName" placeholder="Store Name">
    <input id="newStoreClass" placeholder="Classification" value="C"><input id="newStoreAM" placeholder="Area Manager">
    <input id="newStoreOM" placeholder="Operation Manager"><button class="btn btn-success btn-sm" id="addStoreBtn">Add / Replace</button>
  </div>
  <div class="table-container"><table><thead><tr><th>Code</th><th>Name</th><th>Class</th><th>Area Manager</th><th>Operation Manager</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  getEl("addStoreBtn").onclick=async()=>{
    const code=clean(getEl("newStoreCode").value); if(!code) return toast("Store Code required","warning");
    const s={code,name:clean(getEl("newStoreName").value)||code,classification:clean(getEl("newStoreClass").value||"C").toUpperCase(),
      areaManager:clean(getEl("newStoreAM").value),operationManager:clean(getEl("newStoreOM").value),updatedAt:new Date().toISOString()};
    await adminSet(`storeMaster/${safeKey(code)}`,s); toast("Store saved.","success"); renderAdminStores();
  };
  el.querySelectorAll("[data-edit-store]").forEach(b=>b.onclick=async()=>{
    const s=storesCache[b.dataset.editStore]; if(!s) return;
    const name=prompt("Store Name:",s.name); if(name===null)return;
    const am=prompt("Area Manager:",s.areaManager); if(am===null)return;
    const om=prompt("Operation Manager:",s.operationManager); if(om===null)return;
    await adminSet(`storeMaster/${safeKey(s.code)}`,{...s,name,areaManager:am,operationManager:om,updatedAt:new Date().toISOString()});
    renderAdminStores();
  });
}

async function renderAdminEmployees() {
  const el=getEl("fadmEmp"); if(!el) return;
  const raw=await adminGet("EmpData") || {};
  empCache=normalizeEmployees(raw);
  const rows=empCache.slice(0,1000).map(e=>`<tr><td>${esc(e.employeeId)}</td><td>${esc(e.employeeName)}</td><td>${esc(e.storeCode)}</td><td>${esc(e.status)}</td></tr>`).join("");
  el.innerHTML=`<h4>EmpData</h4><p style="font-size:12px;color:var(--gray-500)">Employee identity/status master. Store transfer mismatch remains allowed, exactly as the Apps Script rule.</p>
  <div class="table-container"><table><thead><tr><th>Employee ID</th><th>Name</th><th>Store Code</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function renderAdminData() {
  const el=getEl("fadmData"); if(!el) return;
  el.innerHTML=`<h4>Data Master Lookup</h4>
  <p style="font-size:12px;color:var(--gray-500)">Firebase lookup uses SKU or Barcodes. The source fields follow the Apps Script Data mapping: SKU, Barcodes, UOM, EN Desc, Cost, Default Supplier, Vendor Code, Category, Non - Returnable & Returnable.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <input id="adminLookupCode" placeholder="Barcode or SKU" style="min-width:240px">
    <button class="btn btn-primary btn-sm" id="adminLookupBtn">Lookup</button>
  </div>
  <pre id="adminLookupOut" style="background:var(--gray-50);padding:12px;border-radius:8px;white-space:pre-wrap"></pre>`;
  getEl("adminLookupBtn").onclick=async()=>{
    try { const p=await lookupProduct(getEl("adminLookupCode").value); getEl("adminLookupOut").textContent=p?JSON.stringify(p,null,2):"Item not found."; }
    catch(e){getEl("adminLookupOut").textContent=errorMessage(e);}
  };
}

async function renderAdminCycle() {
  const el=getEl("fadmCycle"); if(!el) return;
  const raw=await adminGet("categoryCycle") || {};
  const rows=[];
  if(Array.isArray(raw)) rows.push(...raw);
  else if(raw?.rows) rows.push(...raw.rows);
  else Object.entries(raw).forEach(([k,v])=>{if(k!=="headers")rows.push({...v,id:k});});
  el.innerHTML=`<h4>Category Cycle</h4>
  <p style="font-size:12px;color:var(--gray-500)">The Apps Script rule uses the first CategoryCycle row whose Start/End dates contain today.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <input id="cycleCategory" placeholder="Category"><input id="cycleStart" type="date"><input id="cycleEnd" type="date">
    <button class="btn btn-success btn-sm" id="addCycleBtn">Add Cycle</button>
  </div>
  <div class="table-container"><table><thead><tr><th>Category</th><th>Start</th><th>End</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td>${esc(r.category||r.Category||"")}</td><td>${esc(r.startDate||r.start||r.Start||"")}</td><td>${esc(r.endDate||r.end||r.End||"")}</td></tr>`).join("")}
  </tbody></table></div>`;
  getEl("addCycleBtn").onclick=async()=>{
    const category=clean(getEl("cycleCategory").value), start=clean(getEl("cycleStart").value), end=clean(getEl("cycleEnd").value);
    if(!category||!start||!end)return toast("Category, Start and End are required.","warning");
    const current=await adminGet("categoryCycle")||{};
    const list=Array.isArray(current)?current:(current.rows||Object.values(current).filter(v=>v&&typeof v==="object"));
    list.push({category,start,end,sno:String(list.length+1)});
    await adminSet("categoryCycle",list);
    toast("Category cycle saved.","success"); renderAdminCycle();
  };
}

async function renderAdminMin() {
  const el=getEl("fadmMin"); if(!el)return;
  const raw=await adminGet("minQty")||{};
  minQtyCache=raw;
  const cats=Object.keys({...DEFAULT_MIN_QTY,...raw});
  el.innerHTML=`<h4>Minimum Quantity</h4><p style="font-size:12px;color:var(--gray-500)">Values are minimum unique SKU counts by category and store classification.</p>
  <div class="table-container"><table><thead><tr><th>Category</th><th>Values</th></tr></thead><tbody>
  ${cats.map(c=>`<tr><td>${esc(c)}</td><td><pre>${esc(JSON.stringify(raw[c]||DEFAULT_MIN_QTY[c]||{},null,2))}</pre></td></tr>`).join("")}
  </tbody></table></div>`;
}

window.firebaseLookupProduct = lookupProduct;
window.firebaseGetMasters = loadMasters;
window.firebaseConfig = firebaseConfig;
window.firebaseReadyPromise = firebaseReadyPromise;

(async function bootFirebaseReplacement(){
  try {
    await ensureAnonymousAuth();
    await loadMasters();
    await installFirebaseUIHooks();
    // Keep Weekly Expiry visible unless explicitly disabled in Firebase.
    const visible = settingsCache?.homeMenu?.weeklyExpiry;
    if (visible === false && typeof window.homeMenuModuleVisible === "function") {
      // Do not change the original Admin visibility function; only report state.
      console.info("Weekly Expiry is hidden by Firebase settings.");
    }
    console.info("SASCO Firebase replacement ready.", {
      storeCount:Object.keys(storesCache).length,
      employeeCount:empCache.length,
      activeCategory:currentCategory()
    });
    const saved = sessionStorage.getItem("expirySession");
    if (saved) {
      try {
        const session = JSON.parse(saved);
        const live = await dbGet(`storeSessions/${firebaseUser.uid}`);
        const store = storesCache[clean(live?.storeCode || session.storeCode)];
        const emp = findEmployee(live?.employeeId || session.employeeId);
        if (live && store && emp) {
          state.store = store;
          state.employee = emp;
          state.category = currentCategory();
          window.expirySession = live;
          window.expiryToken = `firebase:${firebaseUser.uid}`;
        }
      } catch (e) {
        console.warn("Startup session restore failed", e);
      }
    }
  } catch(e) {
    console.error("Firebase replacement boot failed:",e);
    toast(`Firebase connection failed: ${errorMessage(e)}`,"error");
  }
})();

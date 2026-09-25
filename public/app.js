/* ============================================================
   SASCO PALM EXPIRY MONITORING
   FIREBASE BACKEND - GITHUB VERSION
   NO GOOGLE SCRIPT / NO GOOGLE SHEETS
   ============================================================ */

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  runTransaction
} from
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";


/* ============================================================
   FIREBASE CONFIGURATION
   ============================================================ */

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


/* ============================================================
   INITIALIZE FIREBASE
   ============================================================ */

const firebaseApp = initializeApp(firebaseConfig);

const db = getDatabase(firebaseApp);

const auth = getAuth(firebaseApp);


/* ============================================================
   GLOBAL VARIABLES
   ============================================================ */

let currentUser = null;

let currentStore = null;

let currentEmployee = null;

let currentSession = null;

let employees = {};

let stores = {};

let categories = {};

let storeCategories = {};

let categoryCycle = {};

let minQtySettings = {};

let dataMaster = {};

let barcodeIndex = {};

let skuIndex = {};

let barcodePasteAllowed = true;

let realtimeStarted = false;

let expiryRows = [];

let savedDraft = null;

let adminUser = null;


/* ============================================================
   CONSTANTS
   ============================================================ */

const ADMIN_EMAIL = "sasco270@gmail.com";

const DEFAULT_MIN_QTY = {
  "Confectionery & Sweet Snacks": {
    B: 180,
    C: 80,
    A: 220,
    D: 50,
    Z: 20,
    HR: 60,
    MT: 60,
    X: 40
  },

  "Grocery - Food & Grocery - Non Food": {
    B: 80,
    C: 60,
    A: 100,
    D: 40,
    Z: 5,
    HR: 30,
    MT: 30,
    X: 40
  },

  "Beverages & Dairy & Salty Snacks & Frozen": {
    B: 180,
    C: 150,
    A: 200,
    D: 30,
    Z: 30,
    HR: 40,
    MT: 40,
    X: 60
  }
};


/* ============================================================
   BASIC HELPERS
   ============================================================ */

function clean(value) {
  return String(value ?? "").trim();
}


function lower(value) {
  return clean(value).toLowerCase();
}


function key(value) {
  return clean(value)
    .replace(/[.#$[\]/]/g, "_")
    .replace(/\s+/g, "_");
}


function normalizeCode(value) {
  return clean(value).toUpperCase();
}


function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


function nowISO() {
  return new Date().toISOString();
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function showToast(message, type = "info") {

  if (typeof window.showToast === "function") {
    window.showToast(message, type);
    return;
  }

  console.log(`[${type}] ${message}`);
}


/* ============================================================
   DOM HELPER
   ============================================================ */

function el(id) {
  return document.getElementById(id);
}


function setValue(id, value) {
  const node = el(id);

  if (node) {
    node.value = value ?? "";
  }
}


function setText(id, value) {
  const node = el(id);

  if (node) {
    node.textContent = value ?? "";
  }
}


function setDisplay(id, display) {
  const node = el(id);

  if (node) {
    node.style.display = display;
  }
}


/* ============================================================
   PAGE NAVIGATION
   ============================================================ */

window.showOnly = function(pageId) {

  const pages = [
    "landingPage",
    "weeklyExpiryLoginPage",
    "weeklyExpiryPage",
    "dailyEntryPage",
    "dashboardPage",
    "adminPage"
  ];

  pages.forEach(id => {

    const node = el(id);

    if (!node) return;

    node.style.display =
      id === pageId ? "block" : "none";
  });
};


window.openWeeklyExpiryMonitoring = function() {

  showOnly("weeklyExpiryLoginPage");

  resetExpiryLogin();

  const storeInput = el("expiryLoginStoreCode");

  if (storeInput) {
    storeInput.focus();
  }
};


window.expiryBackToHome = function() {

  resetExpiryLogin();

  showOnly("landingPage");
};


window.goBackToHome = function() {

  showOnly("landingPage");
};


/* ============================================================
   FIREBASE AUTH
   ============================================================ */

async function ensureAnonymousAuth() {

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const result = await signInAnonymously(auth);

  currentUser = result.user;

  return result.user;
}


async function ensureFreshAnonymousAuth() {

  try {

    if (auth.currentUser) {
      await signOut(auth);
    }

  } catch (error) {

    console.warn("Existing auth sign-out:", error);
  }

  const result = await signInAnonymously(auth);

  currentUser = result.user;

  return result.user;
}


/* ============================================================
   AUTH STATE
   ============================================================ */

onAuthStateChanged(auth, user => {

  currentUser = user || null;

  if (user) {

    console.log(
      "Firebase Authentication:",
      user.isAnonymous ? "Anonymous" : user.email
    );

  } else {

    console.log("Firebase Authentication: signed out");
  }
});


/* ============================================================
   FIREBASE READ
   ============================================================ */

async function readPath(path) {

  const snapshot = await get(ref(db, path));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.val();
}


/* ============================================================
   REALTIME DATA
   ============================================================ */

function startRealtime() {

  if (realtimeStarted) {
    return;
  }

  realtimeStarted = true;


  onValue(ref(db, "storeMaster"), snapshot => {

    stores = snapshot.exists()
      ? normalizeStores(snapshot.val())
      : {};

    refreshStoreInfoFromCurrentStore();
  });


  onValue(ref(db, "EmpData"), snapshot => {

    employees = snapshot.exists()
      ? normalizeEmployeeRoot(snapshot.val())
      : {};

    console.log(
      "EmpData loaded:",
      Object.keys(employees).length
    );
  });


  onValue(ref(db, "categories"), snapshot => {

    categories = snapshot.exists()
      ? normalizeCategories(snapshot.val())
      : {};

    refreshCategoryDropdown();
  });


  onValue(ref(db, "storeCategories"), snapshot => {

    storeCategories = snapshot.exists()
      ? snapshot.val()
      : {};

    refreshCategoryDropdown();
  });


  onValue(ref(db, "categoryCycle"), snapshot => {

    categoryCycle = snapshot.exists()
      ? snapshot.val()
      : {};

    refreshCategoryDropdown();
  });


  onValue(ref(db, "minQty"), snapshot => {

    minQtySettings = snapshot.exists()
      ? snapshot.val()
      : {};

    updateMinimumQuantityDisplay();
  });


  onValue(ref(db, "settings/barcodePasteAllowed"), snapshot => {

    barcodePasteAllowed =
      snapshot.exists()
        ? Boolean(snapshot.val())
        : true;
  });


  onValue(ref(db, "Data"), snapshot => {

    dataMaster =
      snapshot.exists()
        ? snapshot.val()
        : {};

  });


  onValue(ref(db, "dataLookup/byBarcode"), snapshot => {

    barcodeIndex =
      snapshot.exists()
        ? snapshot.val()
        : {};

  });


  onValue(ref(db, "dataLookup/bySku"), snapshot => {

    skuIndex =
      snapshot.exists()
        ? snapshot.val()
        : {};

  });
}


/* ============================================================
   START APPLICATION
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {

  try {

    startRealtime();

    await ensureAnonymousAuth();

    console.log("Firebase connected");

  } catch (error) {

    console.error(error);

    showToast(
      "Firebase connection failed: " +
      (error.message || error),
      "error"
    );
  }


  setupExpiryEvents();

});


/* ============================================================
   STORE NORMALIZATION
   ============================================================ */

function normalizeStores(root) {

  const result = {};

  if (!root) {
    return result;
  }


  if (Array.isArray(root)) {

    root.forEach((item, index) => {

      if (!item) return;

      const code =
        normalizeCode(
          item.code ||
          item.storeCode ||
          item["Store Code"] ||
          index
        );

      if (!code) return;

      result[code] = {
        ...item,
        code,
        name:
          item.name ||
          item.storeName ||
          item["Store Name"] ||
          "",
        classification:
          item.classification ||
          item.Classification ||
          "",
        areaManager:
          item.areaManager ||
          item["Area Manager"] ||
          "",
        operationManager:
          item.operationManager ||
          item["Operation Manager"] ||
          "",
        region:
          item.region ||
          item.Region ||
          "",
        location:
          item.location ||
          item.Location ||
          "",
        storeType:
          item.storeType ||
          item["Store Type"] ||
          "",
        email:
          item.email ||
          item.Email ||
          ""
      };
    });

    return result;
  }


  Object.entries(root).forEach(([id, item]) => {

    if (!item || typeof item !== "object") {
      return;
    }

    const code =
      normalizeCode(
        item.code ||
        item.storeCode ||
        item["Store Code"] ||
        id
      );

    if (!code) {
      return;
    }

    result[code] = {
      ...item,
      code,
      name:
        item.name ||
        item.storeName ||
        item["Store Name"] ||
        "",
      classification:
        item.classification ||
        item.Classification ||
        "",
      areaManager:
        item.areaManager ||
        item["Area Manager"] ||
        "",
      operationManager:
        item.operationManager ||
        item["Operation Manager"] ||
        "",
      region:
        item.region ||
        item.Region ||
        "",
      location:
        item.location ||
        item.Location ||
        "",
      storeType:
        item.storeType ||
        item["Store Type"] ||
        "",
      email:
        item.email ||
        item.Email ||
        ""
    };
  });


  return result;
}


/* ============================================================
   EMPLOYEE NORMALIZATION
   ============================================================ */

function normalizeEmployeeRoot(root) {

  const result = {};

  if (!root) {
    return result;
  }


  function addEmployee(item, fallbackId = "") {

    if (!item) {
      return;
    }

    const id = clean(
      item.employeeId ||
      item.employeeID ||
      item.empId ||
      item.empID ||
      item.employeeCode ||
      item.empCode ||
      item["Employee ID"] ||
      item["EmployeeID"] ||
      item["Emp ID"] ||
      item["EmpID"] ||
      item["Employee Code"] ||
      item["EmployeeCode"] ||
      fallbackId
    );


    if (!id) {
      return;
    }


    const employee = {

      ...item,

      employeeId: id,

      employeeName:
        item.employeeName ||
        item.employee_name ||
        item.name ||
        item["Employee Name"] ||
        item["EmployeeName"] ||
        item["Name"] ||
        id,

      storeCode:
        normalizeCode(
          item.storeCode ||
          item.store_code ||
          item["Store Code"] ||
          item["StoreCode"] ||
          item.branchCode ||
          item["Branch Code"] ||
          ""
        ),

      status:
        item.status ||
        item.employeeStatus ||
        item["Employee Status"] ||
        item["EmployeeStatus"] ||
        item["Employment Status"] ||
        item["EmploymentStatus"] ||
        item["Status"] ||
        "Active",

      designation:
        item.designation ||
        item["Designation"] ||
        item.jobTitle ||
        item["Job Title"] ||
        item.role ||
        item["Role"] ||
        ""
    };


    result[id] = employee;
  }


  if (Array.isArray(root)) {

    root.forEach((item, index) => {

      addEmployee(item, String(index));
    });

    return result;
  }


  if (typeof root === "object") {

    Object.entries(root).forEach(([id, item]) => {

      if (!item) {
        return;
      }


      if (typeof item === "object") {

        /*
          Normal direct structure:

          EmpData
             12345
                employeeId
                employeeName
                status
        */

        if (
          item.employeeId ||
          item.employeeID ||
          item.empId ||
          item.empID ||
          item["Employee ID"] ||
          item["Emp ID"]
        ) {

          addEmployee(item, id);

          return;
        }


        /*
          Nested structure:

          EmpData
             stores
                19601
                   12345
                      employeeId
        */

        Object.entries(item).forEach(
          ([nestedId, nestedItem]) => {

            if (
              nestedItem &&
              typeof nestedItem === "object"
            ) {

              addEmployee(
                nestedItem,
                nestedId
              );
            }
          }
        );
      }
    });
  }


  return result;
}


/* ============================================================
   CATEGORY NORMALIZATION
   ============================================================ */

function normalizeCategories(root) {

  const result = {};

  if (!root) {
    return result;
  }


  if (Array.isArray(root)) {

    root.forEach((item, index) => {

      if (!item) return;

      const name =
        clean(
          item.name ||
          item.category ||
          item.Category ||
          item
        );

      if (!name) return;

      result[key(name)] = {
        name,
        active:
          item.active !== false
      };
    });

    return result;
  }


  Object.entries(root).forEach(([id, item]) => {

    if (typeof item === "string") {

      result[id] = {
        name: item,
        active: true
      };

      return;
    }


    if (!item || typeof item !== "object") {
      return;
    }


    const name =
      clean(
        item.name ||
        item.category ||
        item.Category ||
        id
      );


    result[id] = {

      ...item,

      name,

      active:
        item.active !== false
    };
  });


  return result;
}


/* ============================================================
   EMPLOYEE FIND
   ============================================================ */

function findEmployee(employeeId) {

  const id = clean(employeeId);

  if (!id) {
    return null;
  }


  if (employees[id]) {
    return employees[id];
  }


  const target = lower(id);


  for (const employee of Object.values(employees)) {

    if (
      lower(employee.employeeId) === target
    ) {

      return employee;
    }
  }


  return null;
}


/* ============================================================
   EMPLOYEE ACTIVE CHECK
   ============================================================ */

function employeeActive(employee) {

  if (!employee) {
    return false;
  }


  const status =
    lower(employee.status);


  return ![
    "inactive",
    "terminated",
    "resigned",
    "blocked",
    "suspended",
    "left"
  ].includes(status);
}


/* ============================================================
   STORE FIND
   ============================================================ */

function findStore(storeCode) {

  const code =
    normalizeCode(storeCode);

  if (!code) {
    return null;
  }


  if (stores[code]) {
    return stores[code];
  }


  for (const store of Object.values(stores)) {

    if (
      normalizeCode(store.code) === code
    ) {

      return store;
    }
  }


  return null;
}


/* ============================================================
   STORE VERIFICATION
   ============================================================ */

window.expiryVerifyStore = async function() {

  const input =
    el("expiryLoginStoreCode");

  const code =
    normalizeCode(input?.value);


  if (!code) {

    setLoginError(
      "Please enter Store Code."
    );

    return false;
  }


  const store =
    findStore(code);


  if (!store) {

    setLoginError(
      "Store Code " +
      code +
      " was not found in Firebase storeMaster."
    );

    showStoreVerification(null);

    return false;
  }


  currentStore = store;


  showStoreVerification(store);

  setLoginError("");

  showToast(
    "Store verified: " +
    (store.name || code),
    "success"
  );


  return true;
};


/* ============================================================
   SHOW STORE VERIFICATION
   ============================================================ */

function showStoreVerification(store) {

  if (!store) {

    setText(
      "verifiedStoreName",
      "—"
    );

    setText(
      "verifiedStoreCode",
      "—"
    );

    setText(
      "verifiedStoreClass",
      "—"
    );

    setText(
      "verifiedAreaManager",
      "—"
    );

    setText(
      "verifiedOperationManager",
      "—"
    );

    return;
  }


  setText(
    "verifiedStoreName",
    store.name || "—"
  );

  setText(
    "verifiedStoreCode",
    store.code || "—"
  );

  setText(
    "verifiedStoreClass",
    store.classification || "—"
  );

  setText(
    "verifiedAreaManager",
    store.areaManager || "—"
  );

  setText(
    "verifiedOperationManager",
    store.operationManager || "—"
  );


  setValue(
    "storeCodeInput",
    store.code || ""
  );


  setText(
    "classificationBox",
    store.classification || "—"
  );
}


/* ============================================================
   EMPLOYEE LOGIN
   ============================================================ */

window.expiryDoLogin = async function() {

  setLoginError("");


  const storeCode =
    normalizeCode(
      el("expiryLoginStoreCode")?.value
    );


  const employeeId =
    clean(
      el("expiryLoginEmployeeId")?.value
    );


  if (!storeCode) {

    setLoginError(
      "Enter Store Code."
    );

    return;
  }


  let store =
    findStore(storeCode);


  if (!store) {

    const verified =
      await window.expiryVerifyStore();

    if (!verified) {
      return;
    }

    store = currentStore;
  }


  if (!employeeId) {

    setLoginError(
      "Employee ID is required."
    );

    const input =
      el("expiryLoginEmployeeId");

    if (input) {
      input.focus();
    }

    return;
  }


  const employee =
    findEmployee(employeeId);


  if (!employee) {

    setLoginError(
      "Employee ID " +
      employeeId +
      " was not found in Firebase EmpData."
    );

    return;
  }


  if (!employeeActive(employee)) {

    setLoginError(
      "Employee is inactive / terminated / blocked."
    );

    return;
  }


  const button =
    el("expiryLoginBtn");


  if (button) {

    button.disabled = true;

    button.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Opening...';
  }


  try {

    /*
      IMPORTANT:

      Employee store mismatch is NOT rejected.

      This allows temporary transfer / acting
      supervisor / employee working another store.
    */


    const assignmentStatus =
      employee.storeCode &&
      employee.storeCode !== store.code
        ? "TRANSFER / TEMPORARY"
        : employee.storeCode
          ? "MATCHED"
          : "NO MASTER STORE";


    const firebaseUser =
      await ensureFreshAnonymousAuth();


    currentUser =
      firebaseUser;


    const session = {

      storeCode:
        store.code,

      storeName:
        store.name || "",

      employeeId:
        employee.employeeId,

      employeeName:
        employee.employeeName,

      employeeMasterStore:
        employee.storeCode || "",

      assignmentStatus,

      loginAt:
        Date.now()
    };


    /*
      Store login session.

      This is the ONLY session data
      needed by the Firebase app.
    */

    await set(
      ref(
        db,
        "storeSessions/" +
        firebaseUser.uid
      ),
      session
    );


    currentStore =
      store;

    currentEmployee =
      employee;

    currentSession =
      session;


    /*
      Fill Weekly Expiry identity.
    */

    setValue(
      "storeCodeInput",
      store.code
    );


    setValue(
      "empId",
      employee.employeeId
    );


    setText(
      "classificationBox",
      store.classification || "—"
    );


    const badge =
      el("expiryIdentityBadge");


    if (badge) {

      badge.innerHTML =
        '<i class="fas fa-user-check"></i> ' +
        escapeHtml(
          employee.employeeName ||
          employee.employeeId
        ) +
        " · " +
        escapeHtml(store.code);
    }


    /*
      NOW OPEN THE ACTUAL WEEKLY EXPIRY PAGE.
      This happens directly from Firebase.
    */

    showOnly(
      "weeklyExpiryPage"
    );


    /*
      Load Weekly Expiry data.
    */

    await initializeWeeklyExpiry();


    refreshCategoryDropdown();

    loadSavedData();

    checkSubmissionStatus();


    showToast(
      "Weekly Expiry Monitoring opened.",
      "success"
    );


  } catch (error) {

    console.error(
      "Weekly Expiry login error:",
      error
    );


    setLoginError(
      "Unable to open Weekly Expiry: " +
      (error?.message || error)
    );


  } finally {

    if (button) {

      button.disabled = false;

      button.innerHTML =
        '<i class="fas fa-arrow-right-to-bracket"></i> Open Weekly Expiry Monitoring';
    }
  }
};


/* ============================================================
   RESET LOGIN
   ============================================================ */

function resetExpiryLogin() {

  currentStore = null;

  currentEmployee = null;

  currentSession = null;


  setValue(
    "expiryLoginStoreCode",
    ""
  );


  setValue(
    "expiryLoginEmployeeId",
    ""
  );


  showStoreVerification(null);

  setLoginError("");
}


window.expiryResetLoginForm =
  resetExpiryLogin;


function setLoginError(message) {

  const node =
    el("expiryLoginError");

  if (!node) {

    if (message) {
      console.error(message);
    }

    return;
  }


  node.textContent =
    message || "";

  node.style.display =
    message ? "block" : "none";
}


/* ============================================================
   CATEGORY CYCLE
   ============================================================ */

function getCurrentCategoryCycle() {

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );


  let selected = null;


  Object.entries(categoryCycle || {})
    .forEach(([id, cycle]) => {

      if (!cycle) return;

      const start =
        parseDateValue(
          cycle.start ||
          cycle.Start
        );

      const end =
        parseDateValue(
          cycle.end ||
          cycle.End
        );


      if (!start || !end) {
        return;
      }


      if (
        today >= start &&
        today <= end
      ) {

        selected = {
          id,
          ...cycle
        };
      }
    });


  return selected;
}


/* ============================================================
   STORE CATEGORY ASSIGNMENT
   ============================================================ */

function getAssignedCategories(storeCode) {

  const code =
    normalizeCode(storeCode);


  const root =
    storeCategories?.[code];


  if (!root) {
    return [];
  }


  const result = [];


  if (Array.isArray(root)) {

    root.forEach(item => {

      const name =
        clean(
          typeof item === "string"
            ? item
            : item?.name ||
              item?.category
        );

      if (name) {
        result.push(name);
      }
    });


    return result;
  }


  Object.entries(root).forEach(
    ([id, value]) => {

      if (value === true) {

        const category =
          categories[id]?.name ||
          id;

        result.push(category);

        return;
      }


      if (
        value &&
        typeof value === "object" &&
        value.active !== false
      ) {

        const category =
          value.name ||
          value.category ||
          categories[id]?.name ||
          id;

        result.push(category);
      }
    }
  );


  return result;
}


/* ============================================================
   ACTIVE CATEGORY CHECK
   ============================================================ */

function categoryActiveForCycle(categoryName) {

  const cycle =
    getCurrentCategoryCycle();


  if (!cycle) {

    /*
      If no Category Cycle is configured,
      do not hide all categories.
    */

    return true;
  }


  const cycleCategory =
    clean(
      cycle.category ||
      cycle.Category
    );


  if (!cycleCategory) {
    return true;
  }


  return lower(cycleCategory) ===
    lower(categoryName);
}


/* ============================================================
   REFRESH CATEGORY DROPDOWN
   ============================================================ */

function refreshCategoryDropdown() {

  const dropdown =
    el("categoryDropdown");


  if (!dropdown) {
    return;
  }


  const storeCode =
    currentStore?.code ||
    el("storeCodeInput")?.value ||
    "";


  if (!storeCode) {
    return;
  }


  const assigned =
    getAssignedCategories(storeCode);


  const allCategories =
    Object.values(categories)
      .filter(c => c && c.active !== false)
      .map(c => clean(c.name))
      .filter(Boolean);


  let available =
    assigned.length
      ? assigned
      : allCategories;


  /*
    If categoryCycle has a specific category,
    only show that active category.
  */

  available =
    available.filter(
      categoryActiveForCycle
    );


  dropdown.innerHTML =
    '<option value="">Select Category</option>';


  available
    .sort((a, b) =>
      a.localeCompare(b)
    )
    .forEach(category => {

      const option =
        document.createElement("option");

      option.value =
        category;

      option.textContent =
        category;

      dropdown.appendChild(option);
    });


  if (available.length === 1) {

    dropdown.value =
      available[0];

    refreshMinimumQuantity();
  }
}


/* ============================================================
   CURRENT CATEGORY
   ============================================================ */

function getSelectedCategory() {

  return clean(
    el("categoryDropdown")?.value
  );
}


/* ============================================================
   DATA MASTER NORMALIZATION
   ============================================================ */

function getDataItems() {

  const root =
    dataMaster;


  if (!root) {
    return [];
  }


  const items = [];


  /*
    Data/items object format.
  */

  if (
    root.items &&
    typeof root.items === "object"
  ) {

    Object.entries(root.items)
      .forEach(([id, item]) => {

        if (!item) return;

        items.push({
          ...item,
          _id: id
        });
      });
  }


  /*
    Data numeric array format.
  */

  if (Array.isArray(root)) {

    const headers =
      Array.isArray(root.headers)
        ? root.headers
        : null;


    root.forEach((row, index) => {

      if (!Array.isArray(row)) {
        return;
      }


      const item = {};


      if (headers) {

        headers.forEach(
          (header, hIndex) => {

            item[
              clean(header)
            ] =
              row[hIndex];
          }
        );

      } else {

        item.SKU =
          row[0];

        item.Barcodes =
          row[1];

        item.UOM =
          row[2];

        item["EN Desc"] =
          row[3];

        item.Cost =
          row[4];

        item["Default Supplier"] =
          row[5];

        item["Vendor Code"] =
          row[6];

        item.Category =
          row[7];

        item[
          "Non - Returnable & Returnable"
        ] =
          row[8];

        item.Qty =
          row[9];

        item["Total Cost"] =
          row[10];

        item["Expiry Date"] =
          row[11];

        item["Days Left"] =
          row[12];
      }


      item._id =
        String(index);


      items.push(item);
    });
  }


  /*
    Data direct keyed-object format.
  */

  if (
    !root.items &&
    !Array.isArray(root)
  ) {

    Object.entries(root)
      .forEach(([id, item]) => {

        if (!item) return;

        if (
          id === "headers" ||
          id === "meta"
        ) {
          return;
        }


        if (
          typeof item === "object"
        ) {

          items.push({
            ...item,
            _id: id
          });
        }
      });
  }


  return items;
}


/* ============================================================
   PRODUCT FIELD HELPERS
   ============================================================ */

function productBarcode(item) {

  return clean(
    item.barcode ||
    item.Barcode ||
    item.Barcodes ||
    item["Bar Code"] ||
    item["Barcode"] ||
    ""
  );
}


function productSku(item) {

  return clean(
    item.sku ||
    item.SKU ||
    item["Sku"] ||
    item["Item ID"] ||
    item.ItemId ||
    item.itemId ||
    ""
  );
}


function productCategory(item) {

  return clean(
    item.category ||
    item.Category ||
    item["Category Name"] ||
    ""
  );
}


function productDescription(item) {

  return clean(
    item.itemName ||
    item.ItemName ||
    item["EN Desc"] ||
    item.description ||
    item.Description ||
    ""
  );
}


/* ============================================================
   PRODUCT LOOKUP
   ============================================================ */

async function lookupProduct(code) {

  const search =
    clean(code);


  if (!search) {
    return null;
  }


  /*
    1. Barcode index
  */

  const barcodeKey =
    key(search);


  if (
    barcodeIndex &&
    barcodeIndex[barcodeKey]
  ) {

    const item =
      barcodeIndex[barcodeKey];

    return normalizeLookupItem(item);
  }


  /*
    2. SKU index
  */

  const skuKey =
    key(search);


  if (
    skuIndex &&
    skuIndex[skuKey]
  ) {

    const item =
      skuIndex[skuKey];

    return normalizeLookupItem(item);
  }


  /*
    3. Direct Firebase lookup
  */

  try {

    const barcodeSnapshot =
      await get(
        ref(
          db,
          "dataLookup/byBarcode/" +
          barcodeKey
        )
      );


    if (barcodeSnapshot.exists()) {

      return normalizeLookupItem(
        barcodeSnapshot.val()
      );
    }

  } catch (error) {

    console.warn(
      "Barcode index lookup:",
      error
    );
  }


  /*
    4. Search Data master locally
  */

  const items =
    getDataItems();


  const found =
    items.find(item => {

      const barcode =
        productBarcode(item);

      const sku =
        productSku(item);


      return (
        barcode === search ||
        sku === search ||
        barcode
          .split(/[,\s;|]+/)
          .includes(search)
      );
    });


  return found
    ? normalizeLookupItem(found)
    : null;
}


/* ============================================================
   NORMALIZE LOOKUP ITEM
   ============================================================ */

function normalizeLookupItem(item) {

  if (!item) {
    return null;
  }


  return {

    ...item,

    sku:
      productSku(item),

    barcode:
      productBarcode(item),

    category:
      productCategory(item),

    itemName:
      productDescription(item),

    UOM:
      clean(
        item.UOM ||
        item.uom ||
        item.UnitId ||
        item.Unit ||
        ""
      ),

    cost:
      safeNumber(
        item.Cost ||
        item.cost
      ),

    vendor:
      clean(
        item["Default Supplier"] ||
        item.DefaultSupplier ||
        item.vendor ||
        ""
      ),

    vendorCode:
      clean(
        item["Vendor Code"] ||
        item.VendorCode ||
        ""
      )
  };
}


/* ============================================================
   BARCODE SCAN
   ============================================================ */

window.handleScan = async function(barcode) {

  const code =
    clean(barcode);


  if (!code) {
    return;
  }


  const category =
    getSelectedCategory();


  if (!category) {

    showToast(
      "Please select Category first.",
      "warning"
    );

    return;
  }


  try {

    const item =
      await lookupProduct(code);


    if (!item) {

      showToast(
        "Item not found in Firebase Data master.",
        "error"
      );

      return;
    }


    if (
      lower(item.category) !==
      lower(category)
    ) {

      showToast(
        "This item belongs to category: " +
        (item.category || "Unknown") +
        ".",
        "warning"
      );

      return;
    }


    addExpiryItem(item);


  } catch (error) {

    console.error(error);

    showToast(
      "Item lookup failed: " +
      (error.message || error),
      "error"
    );
  }
};


/* ============================================================
   ADD EXPIRY ITEM
   ============================================================ */

function addExpiryItem(item) {

  const barcode =
    productBarcode(item);

  const sku =
    productSku(item);


  if (!barcode && !sku) {

    showToast(
      "Item has no SKU or Barcode.",
      "error"
    );

    return;
  }


  const existing =
    expiryRows.filter(row =>
      row.barcode === barcode
    );


  if (existing.length >= 3) {

    showToast(
      "Maximum 3 expiry dates allowed for the same barcode.",
      "warning"
    );

    return;
  }


  const row = {

    id:
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2),

    sku,

    barcode,

    category:
      getSelectedCategory(),

    itemName:
      productDescription(item),

    UOM:
      item.UOM || "",

    Qty:
      1,

    ExpiryDate:
      "",

    DaysLeft:
      "",

    cost:
      safeNumber(item.cost),

    vendor:
      item.vendor || "",

    vendorCode:
      item.vendorCode || ""
  };


  expiryRows.push(row);

  renderExpiryTable();


  const barcodeInput =
    el("barcodeInput");


  if (barcodeInput) {
    barcodeInput.value = "";
    barcodeInput.focus();
  }
}


/* ============================================================
   RENDER EXPIRY TABLE
   ============================================================ */

function renderExpiryTable() {

  const table =
    el("dataTable");


  if (!table) {
    return;
  }


  const tbody =
    table.querySelector("tbody") ||
    table;


  tbody.innerHTML = "";


  expiryRows.forEach(
    (row, index) => {

      const tr =
        document.createElement("tr");


      tr.innerHTML = `

        <td>${index + 1}</td>

        <td>
          ${escapeHtml(row.sku)}
        </td>

        <td>
          ${escapeHtml(row.barcode)}
        </td>

        <td>
          ${escapeHtml(row.itemName)}
        </td>

        <td>
          ${escapeHtml(row.UOM)}
        </td>

        <td>
          <input
            type="number"
            min="1"
            value="${row.Qty}"
            class="expiry-qty"
            data-index="${index}"
          >
        </td>

        <td>
          <input
            type="text"
            placeholder="DD/MM/YYYY"
            value="${escapeHtml(row.ExpiryDate)}"
            class="expiry-date"
            data-index="${index}"
          >
        </td>

        <td>
          ${escapeHtml(
            row.DaysLeft ?? ""
          )}
        </td>

        <td>
          <button
            type="button"
            class="btn-danger expiry-delete"
            data-index="${index}"
          >
            <i class="fas fa-trash"></i>
          </button>
        </td>

      `;


      tbody.appendChild(tr);
    }
  );


  tbody
    .querySelectorAll(".expiry-qty")
    .forEach(input => {

      input.addEventListener(
        "input",
        e => {

          const index =
            Number(
              e.target.dataset.index
            );

          expiryRows[index].Qty =
            safeNumber(
              e.target.value,
              0
            );
        }
      );
    });


  tbody
    .querySelectorAll(".expiry-date")
    .forEach(input => {

      input.addEventListener(
        "change",
        e => {

          const index =
            Number(
              e.target.dataset.index
            );

          const value =
            clean(e.target.value);


          expiryRows[index].ExpiryDate =
            value;


          const days =
            calculateDaysLeft(value);


          expiryRows[index].DaysLeft =
            days;


          renderExpiryTable();
        }
      );
    });


  tbody
    .querySelectorAll(".expiry-delete")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const index =
            Number(
              button.dataset.index
            );

          expiryRows.splice(
            index,
            1
          );

          renderExpiryTable();
        }
      );
    });
}


/* ============================================================
   DATE PARSER
   ============================================================ */

function parseDateValue(value) {

  const text =
    clean(value);


  if (!text) {
    return null;
  }


  let day;
  let month;
  let year;


  if (
    /^\d{2}\/\d{2}\/\d{4}$/
      .test(text)
  ) {

    [
      day,
      month,
      year
    ] =
      text.split("/")
        .map(Number);

  } else if (
    /^\d{4}-\d{2}-\d{2}$/
      .test(text)
  ) {

    [
      year,
      month,
      day
    ] =
      text.split("-")
        .map(Number);

  } else {

    const date =
      new Date(text);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return null;
    }

    return date;
  }


  const date =
    new Date(
      year,
      month - 1,
      day
    );


  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {

    return null;
  }


  return date;
}


/* ============================================================
   DAYS LEFT
   ============================================================ */

function calculateDaysLeft(value) {

  const date =
    parseDateValue(value);


  if (!date) {
    return "";
  }


  const today =
    new Date();


  today.setHours(
    0,
    0,
    0,
    0
  );


  date.setHours(
    0,
    0,
    0,
    0
  );


  return Math.ceil(
    (
      date.getTime() -
      today.getTime()
    ) /
    86400000
  );
}


/* ============================================================
   EXPIRY DATE VALIDATION
   ============================================================ */

function validateExpiryDate(value) {

  const date =
    parseDateValue(value);


  if (!date) {

    return {
      ok: false,
      message:
        "Expiry Date must be DD/MM/YYYY."
    };
  }


  const today =
    new Date();


  today.setHours(
    0,
    0,
    0,
    0
  );


  const minimum =
    new Date(today);


  minimum.setDate(
    minimum.getDate() - 21
  );


  const maximum =
    new Date(
      2035,
      11,
      31
    );


  if (date < minimum) {

    return {
      ok: false,
      message:
        "Expiry Date cannot be older than 21 days."
    };
  }


  if (date > maximum) {

    return {
      ok: false,
      message:
        "Expiry Date cannot be after 31/12/2035."
    };
  }


  return {
    ok: true
  };
}


/* ============================================================
   INITIALIZE WEEKLY EXPIRY
   ============================================================ */

window.initializeWeeklyExpiry =
async function() {

  if (!currentStore) {

    const code =
      el("storeCodeInput")?.value;

    if (code) {
      currentStore =
        findStore(code);
    }
  }


  expiryRows = [];

  renderExpiryTable();

  refreshCategoryDropdown();

  updateMinimumQuantityDisplay();
};


/* ============================================================
   SAVE DRAFT
   ============================================================ */

window.saveWeeklyExpiry =
async function() {

  if (!currentStore) {

    showToast(
      "Store session is missing.",
      "error"
    );

    return;
  }


  const category =
    getSelectedCategory();


  if (!category) {

    showToast(
      "Select Category.",
      "warning"
    );

    return;
  }


  const validation =
    validateExpiryRows();


  if (!validation.ok) {

    showToast(
      validation.message,
      "warning"
    );

    return;
  }


  const cycle =
    getCurrentCategoryCycle();


  const cycleId =
    cycle?.id ||
    "current";


  const draft = {

    storeCode:
      currentStore.code,

    storeName:
      currentStore.name || "",

    category,

    cycleId,

    items:
      expiryRows,

    status:
      "DRAFT",

    employeeId:
      currentEmployee?.employeeId || "",

    employeeName:
      currentEmployee?.employeeName || "",

    updatedAt:
      Date.now()
  };


  try {

    await set(
      ref(
        db,
        "expiryDrafts/" +
        key(currentStore.code) +
        "/" +
        key(cycleId) +
        "/" +
        key(category)
      ),
      draft
    );


    savedDraft =
      draft;


    showToast(
      "Draft saved successfully.",
      "success"
    );


    updateSavedDraftDisplay();


  } catch (error) {

    console.error(error);

    showToast(
      "Unable to save draft: " +
      error.message,
      "error"
    );
  }
};


/* ============================================================
   LOAD SAVED DRAFT
   ============================================================ */

async function loadSavedData() {

  if (!currentStore) {
    return;
  }


  const category =
    getSelectedCategory();


  if (!category) {
    return;
  }


  const cycle =
    getCurrentCategoryCycle();


  const cycleId =
    cycle?.id ||
    "current";


  try {

    const snapshot =
      await get(
        ref(
          db,
          "expiryDrafts/" +
          key(currentStore.code) +
          "/" +
          key(cycleId) +
          "/" +
          key(category)
        )
      );


    if (
      snapshot.exists()
    ) {

      savedDraft =
        snapshot.val();


      expiryRows =
        Array.isArray(
          savedDraft.items
        )
          ? savedDraft.items
          : [];


      renderExpiryTable();

      updateSavedDraftDisplay();
    }

  } catch (error) {

    console.warn(
      "Draft load:",
      error
    );
  }
}


/* ============================================================
   FINAL SUBMISSION
   ============================================================ */

window.submitWeeklyExpiry =
async function() {

  if (!currentStore) {

    showToast(
      "Store session is missing.",
      "error"
    );

    return;
  }


  const category =
    getSelectedCategory();


  if (!category) {

    showToast(
      "Select Category.",
      "warning"
    );

    return;
  }


  const validation =
    validateExpiryRows();


  if (!validation.ok) {

    showToast(
      validation.message,
      "warning"
    );

    return;
  }


  const cycle =
    getCurrentCategoryCycle();


  const cycleId =
    cycle?.id ||
    "current";


  const submission = {

    storeCode:
      currentStore.code,

    storeName:
      currentStore.name || "",

    category,

    cycleId,

    items:
      expiryRows,

    status:
      "SUBMITTED",

    itemCount:
      expiryRows.length,

    employeeId:
      currentEmployee?.employeeId || "",

    employeeName:
      currentEmployee?.employeeName || "",

    submittedAt:
      Date.now()
  };


  const submissionRef =
    ref(
      db,
      "storeSubmissions/" +
      key(currentStore.code) +
      "/" +
      key(category) +
      "/" +
      key(cycleId)
    );


  try {

    const transactionResult =
      await runTransaction(
        submissionRef,
        current => {

          /*
            If already submitted,
            keep the existing submission.
          */

          if (
            current !== null
          ) {

            return;
          }


          return submission;
        }
      );


    if (
      !transactionResult.committed
    ) {

      showToast(
        "This category has already been submitted.",
        "warning"
      );

      checkSubmissionStatus();

      return;
    }


    /*
      Delete draft after final submission.
    */

    await remove(
      ref(
        db,
        "expiryDrafts/" +
        key(currentStore.code) +
        "/" +
        key(cycleId) +
        "/" +
        key(category)
      )
    );


    savedDraft =
      null;


    showToast(
      "Weekly Expiry submitted successfully.",
      "success"
    );


    updateSavedDraftDisplay();

    checkSubmissionStatus();

    downloadSubmissionCSV(
      submission
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Submission failed: " +
      error.message,
      "error"
    );
  }
};


/* ============================================================
   VALIDATE EXPIRY ROWS
   ============================================================ */

function validateExpiryRows() {

  if (!expiryRows.length) {

    return {
      ok: false,
      message:
        "Please add at least one item."
    };
  }


  const validRows =
    expiryRows.filter(
      row =>
        safeNumber(row.Qty) > 0 &&
        clean(row.ExpiryDate)
    );


  if (!validRows.length) {

    return {
      ok: false,
      message:
        "At least one item must have Qty and Expiry Date."
    };
  }


  for (
    const row of validRows
  ) {

    const result =
      validateExpiryDate(
        row.ExpiryDate
      );


    if (!result.ok) {

      return {
        ok: false,
        message:
          `${row.sku || row.barcode}: ${result.message}`
      };
    }
  }


  const uniqueItems =
    new Set(
      validRows.map(
        row =>
          row.sku ||
          row.barcode
      )
    );


  const minimum =
    getMinimumRequired();


  if (
    uniqueItems.size <
    minimum
  ) {

    return {
      ok: false,
      message:
        `Minimum ${minimum} unique SKU(s) required. Current: ${uniqueItems.size}.`
    };
  }


  return {
    ok: true
  };
}


/* ============================================================
   MINIMUM QUANTITY
   ============================================================ */

function getMinimumRequired() {

  const category =
    getSelectedCategory();


  if (
    minQtySettings &&
    minQtySettings[category]
  ) {

    const storeClass =
      currentStore?.classification ||
      "B";


    return safeNumber(
      minQtySettings[category]?.[
        storeClass
      ],
      0
    );
  }


  const defaults =
    DEFAULT_MIN_QTY[
      category
    ];


  if (!defaults) {
    return 0;
  }


  const storeClass =
    currentStore?.classification ||
    "B";


  return safeNumber(
    defaults[storeClass],
    0
  );
}


/* ============================================================
   MINIMUM QUANTITY DISPLAY
   ============================================================ */

function refreshMinimumQuantity() {

  updateMinimumQuantityDisplay();
}


function updateMinimumQuantityDisplay() {

  const minimum =
    getMinimumRequired();


  const possibleIds = [
    "minQtyValue",
    "minimumSkuValue",
    "minSkuValue"
  ];


  possibleIds.forEach(
    id => {

      const node =
        el(id);

      if (node) {
        node.textContent =
          minimum;
      }
    }
  );
}


/* ============================================================
   SUBMISSION STATUS
   ============================================================ */

async function checkSubmissionStatus() {

  if (!currentStore) {
    return;
  }


  const category =
    getSelectedCategory();


  if (!category) {
    return;
  }


  const cycle =
    getCurrentCategoryCycle();


  const cycleId =
    cycle?.id ||
    "current";


  try {

    const snapshot =
      await get(
        ref(
          db,
          "storeSubmissions/" +
          key(currentStore.code) +
          "/" +
          key(category) +
          "/" +
          key(cycleId)
        )
      );


    const submitted =
      snapshot.exists();


    const submitButton =
      el("weeklySubmitBtn");


    if (submitButton) {

      submitButton.disabled =
        submitted;
    }


    const statusNode =
      el("submissionStatus");


    if (statusNode) {

      statusNode.textContent =
        submitted
          ? "SUBMITTED"
          : "NOT SUBMITTED";

      statusNode.className =
        submitted
          ? "status submitted"
          : "status pending";
    }


  } catch (error) {

    console.warn(
      "Submission status:",
      error
    );
  }
}


/* ============================================================
   UPDATE SAVED DRAFT DISPLAY
   ============================================================ */

function updateSavedDraftDisplay() {

  const node =
    el("savedDraftCard");


  if (!node) {
    return;
  }


  if (!savedDraft) {

    node.style.display =
      "none";

    return;
  }


  node.style.display =
    "block";


  const count =
    Array.isArray(
      savedDraft.items
    )
      ? savedDraft.items.length
      : 0;


  node.innerHTML = `

    <div>
      <strong>Saved Draft</strong>
    </div>

    <div>
      ${escapeHtml(
        savedDraft.category || ""
      )}
    </div>

    <div>
      ${count} item(s)
    </div>

  `;
}


/* ============================================================
   CSV DOWNLOAD
   ============================================================ */

function downloadSubmissionCSV(
  submission
) {

  const rows = [];


  rows.push([
    "Store Code",
    "Store Name",
    "Category",
    "SKU",
    "Barcode",
    "Item Name",
    "UOM",
    "Qty",
    "Expiry Date",
    "Days Left",
    "Employee ID",
    "Employee Name"
  ]);


  submission.items.forEach(
    item => {

      rows.push([
        submission.storeCode,
        submission.storeName,
        submission.category,
        item.sku,
        item.barcode,
        item.itemName,
        item.UOM,
        item.Qty,
        item.ExpiryDate,
        calculateDaysLeft(
          item.ExpiryDate
        ),
        submission.employeeId,
        submission.employeeName
      ]);
    }
  );


  const csv =
    rows.map(
      row =>
        row.map(
          value =>
            '"' +
            String(
              value ?? ""
            )
              .replace(
                /"/g,
                '""'
              ) +
            '"'
        ).join(",")
    ).join("\n");


  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;"
      }
    );


  const url =
    URL.createObjectURL(blob);


  const a =
    document.createElement("a");


  a.href = url;


  a.download =
    `Expiry_${submission.storeCode}_${submission.category}_${submission.cycleId}.csv`;


  document.body.appendChild(a);

  a.click();

  a.remove();

  URL.revokeObjectURL(url);
}


/* ============================================================
   REFRESH STORE INFO
   ============================================================ */

function refreshStoreInfoFromCurrentStore() {

  if (!currentStore) {
    return;
  }


  const latest =
    findStore(
      currentStore.code
    );


  if (!latest) {
    return;
  }


  currentStore =
    latest;


  showStoreVerification(
    latest
  );
}


/* ============================================================
   EVENT SETUP
   ============================================================ */

function setupExpiryEvents() {

  const storeInput =
    el("expiryLoginStoreCode");


  if (storeInput) {

    storeInput.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Enter"
        ) {

          event.preventDefault();

          window.expiryVerifyStore();
        }
      }
    );
  }


  const employeeInput =
    el("expiryLoginEmployeeId");


  if (employeeInput) {

    employeeInput.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Enter"
        ) {

          event.preventDefault();

          window.expiryDoLogin();
        }
      }
    );
  }


  const barcodeInput =
    el("barcodeInput");


  if (barcodeInput) {

    barcodeInput.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Enter"
        ) {

          event.preventDefault();

          const code =
            clean(
              barcodeInput.value
            );


          if (code) {

            window.handleScan(
              code
            );

            barcodeInput.value =
              "";
          }
        }
      }
    );
  }


  const categoryDropdown =
    el("categoryDropdown");


  if (categoryDropdown) {

    categoryDropdown.addEventListener(
      "change",
      async () => {

        expiryRows = [];

        renderExpiryTable();

        refreshMinimumQuantity();

        await loadSavedData();

        checkSubmissionStatus();
      }
    );
  }


  const saveButton =
    el("saveBtn");


  if (saveButton) {

    saveButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        window.saveWeeklyExpiry();
      }
    );
  }


  const submitButton =
    el("weeklySubmitBtn");


  if (submitButton) {

    submitButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        window.submitWeeklyExpiry();
      }
    );
  }


  const loginButton =
    el("expiryLoginBtn");


  if (loginButton) {

    loginButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        window.expiryDoLogin();
      }
    );
  }
}


/* ============================================================
   ADMIN AUTH
   ============================================================ */

window.adminLogin =
async function() {

  const email =
    clean(
      el("adminEmail")?.value
    );


  const password =
    el("adminPassword")?.value ||
    "";


  if (!email || !password) {

    showToast(
      "Enter Admin Email and Password.",
      "warning"
    );

    return;
  }


  try {

    const result =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );


    adminUser =
      result.user;


    /*
      Bootstrap admin.

      Only the configured admin email
      can create its own /admins UID.
    */

    if (
      lower(result.user.email) ===
      lower(ADMIN_EMAIL)
    ) {

      await set(
        ref(
          db,
          "admins/" +
          result.user.uid
        ),
        true
      );
    }


    const adminSnapshot =
      await get(
        ref(
          db,
          "admins/" +
          result.user.uid
        )
      );


    if (
      !adminSnapshot.exists() ||
      adminSnapshot.val() !== true
    ) {

      await signOut(auth);

      throw new Error(
        "This account is not authorized as an administrator."
      );
    }


    showOnly("adminPage");


    showToast(
      "Admin login successful.",
      "success"
    );


    loadAdminData();


  } catch (error) {

    console.error(error);

    showToast(
      error.message ||
      "Admin login failed.",
      "error"
    );
  }
};


/* ============================================================
   ADMIN LOGOUT
   ============================================================ */

window.adminLogout =
async function() {

  try {

    await signOut(auth);

  } catch (error) {

    console.warn(error);
  }


  adminUser = null;

  showOnly("landingPage");
};


/* ============================================================
   ADMIN CHECK
   ============================================================ */

async function requireAdmin() {

  if (!auth.currentUser) {

    throw new Error(
      "Admin authentication required."
    );
  }


  const snapshot =
    await get(
      ref(
        db,
        "admins/" +
        auth.currentUser.uid
      )
    );


  if (
    !snapshot.exists() ||
    snapshot.val() !== true
  ) {

    throw new Error(
      "Administrator permission required."
    );
  }


  return true;
}


/* ============================================================
   ADMIN LOAD
   ============================================================ */

async function loadAdminData() {

  try {

    await requireAdmin();


    const [
      storeSnapshot,
      employeeSnapshot,
      categorySnapshot
    ] =
      await Promise.all([

        get(
          ref(db, "storeMaster")
        ),

        get(
          ref(db, "EmpData")
        ),

        get(
          ref(db, "categories")
        )
      ]);


    renderAdminStores(
      storeSnapshot.val() || {}
    );


    renderAdminEmployees(
      employeeSnapshot.val() || {}
    );


    renderAdminCategories(
      categorySnapshot.val() || {}
    );


  } catch (error) {

    console.error(error);

    showToast(
      error.message,
      "error"
    );
  }
}


/* ============================================================
   ADMIN STORE
   ============================================================ */

window.adminSaveStore =
async function() {

  try {

    await requireAdmin();


    const code =
      normalizeCode(
        el("adminStoreCode")?.value
      );


    if (!code) {

      throw new Error(
        "Store Code is required."
      );
    }


    const store = {

      code,

      name:
        clean(
          el("adminStoreName")?.value
        ),

      classification:
        clean(
          el("adminStoreClassification")?.value
        ),

      areaManager:
        clean(
          el("adminStoreAreaManager")?.value
        ),

      operationManager:
        clean(
          el("adminStoreOperationManager")?.value
        ),

      region:
        clean(
          el("adminStoreRegion")?.value
        ),

      location:
        clean(
          el("adminStoreLocation")?.value
        ),

      storeType:
        clean(
          el("adminStoreType")?.value
        ),

      email:
        clean(
          el("adminStoreEmail")?.value
        ),

      updatedAt:
        Date.now()
    };


    await set(
      ref(
        db,
        "storeMaster/" +
        key(code)
      ),
      store
    );


    showToast(
      "Store saved.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN DELETE STORE
   ============================================================ */

window.adminDeleteStore =
async function(code) {

  try {

    await requireAdmin();


    if (
      !confirm(
        "Delete Store " +
        code +
        "?"
      )
    ) {
      return;
    }


    await remove(
      ref(
        db,
        "storeMaster/" +
        key(code)
      )
    );


    showToast(
      "Store deleted.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN CATEGORY
   ============================================================ */

window.adminSaveCategory =
async function() {

  try {

    await requireAdmin();


    const name =
      clean(
        el("adminCategoryName")?.value
      );


    if (!name) {

      throw new Error(
        "Category name is required."
      );
    }


    const id =
      key(name);


    await set(
      ref(
        db,
        "categories/" +
        id
      ),
      {
        name,
        active: true,
        updatedAt: Date.now()
      }
    );


    showToast(
      "Category saved.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN DELETE CATEGORY
   ============================================================ */

window.adminDeleteCategory =
async function(categoryId) {

  try {

    await requireAdmin();


    if (
      !confirm(
        "Delete this category?"
      )
    ) {
      return;
    }


    await remove(
      ref(
        db,
        "categories/" +
        key(categoryId)
      )
    );


    showToast(
      "Category deleted.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN STORE CATEGORY ASSIGNMENT
   ============================================================ */

window.adminAssignCategory =
async function(
  storeCode,
  category,
  assigned
) {

  try {

    await requireAdmin();


    await set(
      ref(
        db,
        "storeCategories/" +
        key(storeCode) +
        "/" +
        key(category)
      ),
      Boolean(assigned)
    );


    showToast(
      assigned
        ? "Category assigned."
        : "Category removed.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN MINIMUM QUANTITY
   ============================================================ */

window.adminSaveMinQty =
async function() {

  try {

    await requireAdmin();


    const category =
      clean(
        el("adminMinQtyCategory")?.value
      );


    const classification =
      clean(
        el("adminMinQtyClass")?.value
      );


    const value =
      safeNumber(
        el("adminMinQtyValue")?.value
      );


    if (
      !category ||
      !classification
    ) {

      throw new Error(
        "Category and classification are required."
      );
    }


    await set(
      ref(
        db,
        "minQty/" +
        key(category) +
        "/" +
        key(classification)
      ),
      value
    );


    showToast(
      "Minimum quantity saved.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN BARCODE SETTING
   ============================================================ */

window.adminSetBarcodePaste =
async function(value) {

  try {

    await requireAdmin();


    await set(
      ref(
        db,
        "settings/barcodePasteAllowed"
      ),
      Boolean(value)
    );


    showToast(
      "Barcode setting updated.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN DATA MASTER SAVE
   ============================================================ */

window.adminSaveDataItem =
async function(itemId, item) {

  try {

    await requireAdmin();


    if (!itemId) {

      itemId =
        push(
          ref(db, "Data/items")
        ).key;
    }


    await set(
      ref(
        db,
        "Data/items/" +
        key(itemId)
      ),
      {
        ...item,
        updatedAt: Date.now()
      }
    );


    /*
      Update barcode index.
    */

    const barcode =
      productBarcode(item);


    const sku =
      productSku(item);


    const updates = {};


    if (barcode) {

      updates[
        "dataLookup/byBarcode/" +
        key(barcode)
      ] = {
        ...item,
        itemId
      };
    }


    if (sku) {

      updates[
        "dataLookup/bySku/" +
        key(sku)
      ] = {
        ...item,
        itemId
      };
    }


    if (
      Object.keys(updates).length
    ) {

      await update(
        ref(db),
        updates
      );
    }


    showToast(
      "Data Master item saved.",
      "success"
    );


  } catch (error) {

    console.error(error);

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN DELETE DATA ITEM
   ============================================================ */

window.adminDeleteDataItem =
async function(itemId) {

  try {

    await requireAdmin();


    if (
      !confirm(
        "Delete this Data Master item?"
      )
    ) {
      return;
    }


    await remove(
      ref(
        db,
        "Data/items/" +
        key(itemId)
      )
    );


    showToast(
      "Data Master item deleted.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   BUILD DATA LOOKUP INDEX
   ============================================================ */

window.buildDataLookupIndex =
async function() {

  try {

    await requireAdmin();


    const items =
      getDataItems();


    if (!items.length) {

      throw new Error(
        "No Data Master items found."
      );
    }


    const updates = {};


    items.forEach(
      item => {

        const barcode =
          productBarcode(item);


        const sku =
          productSku(item);


        if (barcode) {

          updates[
            "dataLookup/byBarcode/" +
            key(barcode)
          ] = item;
        }


        if (sku) {

          updates[
            "dataLookup/bySku/" +
            key(sku)
          ] = item;
        }
      }
    );


    const entries =
      Object.entries(updates);


    /*
      Firebase update has a practical payload
      limitation, so write in chunks.
    */

    const chunkSize =
      500;


    for (
      let i = 0;
      i < entries.length;
      i += chunkSize
    ) {

      const chunk =
        Object.fromEntries(
          entries.slice(
            i,
            i + chunkSize
          )
        );


      await update(
        ref(db),
        chunk
      );
    }


    showToast(
      `Lookup index built: ${entries.length} records.`,
      "success"
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Index build failed: " +
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN RENDER HELPERS
   ============================================================ */

function renderAdminStores(root) {

  const node =
    el("adminStoresList");


  if (!node) {
    return;
  }


  const normalized =
    normalizeStores(root);


  node.innerHTML =
    Object.values(normalized)
      .sort(
        (a, b) =>
          a.code.localeCompare(
            b.code
          )
      )
      .map(
        store => `

          <div class="admin-row">

            <strong>
              ${escapeHtml(store.code)}
            </strong>

            <span>
              ${escapeHtml(store.name || "")}
            </span>

            <span>
              ${escapeHtml(
                store.areaManager || ""
              )}
            </span>

            <button
              type="button"
              onclick="adminDeleteStore('${escapeHtml(store.code)}')"
            >
              Delete
            </button>

          </div>

        `
      )
      .join("");
}


function renderAdminEmployees(root) {

  const node =
    el("adminEmployeesList");


  if (!node) {
    return;
  }


  const normalized =
    normalizeEmployeeRoot(root);


  node.innerHTML =
    Object.values(normalized)
      .slice(0, 500)
      .map(
        employee => `

          <div class="admin-row">

            <strong>
              ${escapeHtml(
                employee.employeeId
              )}
            </strong>

            <span>
              ${escapeHtml(
                employee.employeeName
              )}
            </span>

            <span>
              ${escapeHtml(
                employee.status
              )}
            </span>

          </div>

        `
      )
      .join("");
}


function renderAdminCategories(root) {

  const node =
    el("adminCategoriesList");


  if (!node) {
    return;
  }


  const normalized =
    normalizeCategories(root);


  node.innerHTML =
    Object.entries(normalized)
      .map(
        ([id, category]) => `

          <div class="admin-row">

            <strong>
              ${escapeHtml(
                category.name
              )}
            </strong>

            <span>
              ${
                category.active !== false
                  ? "Active"
                  : "Inactive"
              }
            </span>

            <button
              type="button"
              onclick="adminDeleteCategory('${escapeHtml(id)}')"
            >
              Delete
            </button>

          </div>

        `
      )
      .join("");
}


/* ============================================================
   ADMIN CATEGORY CYCLE
   ============================================================ */

window.adminSaveCategoryCycle =
async function() {

  try {

    await requireAdmin();


    const category =
      clean(
        el("adminCycleCategory")?.value
      );


    const start =
      clean(
        el("adminCycleStart")?.value
      );


    const end =
      clean(
        el("adminCycleEnd")?.value
      );


    if (
      !category ||
      !start ||
      !end
    ) {

      throw new Error(
        "Category, Start and End are required."
      );
    }


    const id =
      clean(
        el("adminCycleId")?.value
      ) ||
      "cycle_" +
      Date.now();


    await set(
      ref(
        db,
        "categoryCycle/" +
        key(id)
      ),
      {
        id,
        category,
        start,
        end,
        active: true,
        updatedAt: Date.now()
      }
    );


    showToast(
      "Category cycle saved.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   ADMIN CATEGORY CYCLE DELETE
   ============================================================ */

window.adminDeleteCategoryCycle =
async function(id) {

  try {

    await requireAdmin();


    await remove(
      ref(
        db,
        "categoryCycle/" +
        key(id)
      )
    );


    showToast(
      "Category cycle deleted.",
      "success"
    );


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   PRINT REPORT
   ============================================================ */

window.printReport =
function() {

  window.print();
};


/* ============================================================
   ADMIN DATA EXPORT
   ============================================================ */

window.exportFirebaseData =
async function() {

  try {

    await requireAdmin();


    const snapshot =
      await get(
        ref(db)
      );


    if (!snapshot.exists()) {

      throw new Error(
        "No Firebase data found."
      );
    }


    const json =
      JSON.stringify(
        snapshot.val(),
        null,
        2
      );


    const blob =
      new Blob(
        [json],
        {
          type:
            "application/json"
        }
      );


    const url =
      URL.createObjectURL(blob);


    const a =
      document.createElement("a");


    a.href = url;

    a.download =
      "expiry-monitoring-firebase-backup.json";


    document.body.appendChild(a);

    a.click();

    a.remove();

    URL.revokeObjectURL(url);


  } catch (error) {

    showToast(
      error.message,
      "error"
    );
  }
};


/* ============================================================
   LOGOUT STORE SESSION
   ============================================================ */

window.expiryLogout =
async function() {

  try {

    if (auth.currentUser) {

      const uid =
        auth.currentUser.uid;


      await remove(
        ref(
          db,
          "storeSessions/" +
          uid
        )
      );
    }

  } catch (error) {

    console.warn(
      "Session cleanup:",
      error
    );

  } finally {

    try {

      await signOut(auth);

    } catch (error) {

      console.warn(error);
    }


    currentUser = null;

    currentStore = null;

    currentEmployee = null;

    currentSession = null;

    expiryRows = [];

    showOnly(
      "landingPage"
    );
  }
};


window.expiryLogoutAndHome =
window.expiryLogout;


/* ============================================================
   RESUME SESSION
   ============================================================ */

window.expiryTryResume =
async function() {

  /*
    Firebase sessions are intentionally not
    automatically resumed after browser reload.

    User returns to Store Access login.
  */

  showOnly(
    "weeklyExpiryLoginPage"
  );
};


/* ============================================================
   STORE SESSION VALIDATION
   ============================================================ */

async function validateCurrentFirebaseSession() {

  if (!auth.currentUser) {
    return false;
  }


  const snapshot =
    await get(
      ref(
        db,
        "storeSessions/" +
        auth.currentUser.uid
      )
    );


  if (!snapshot.exists()) {
    return false;
  }


  currentSession =
    snapshot.val();


  currentStore =
    findStore(
      currentSession.storeCode
    );


  currentEmployee =
    findEmployee(
      currentSession.employeeId
    );


  return Boolean(
    currentStore &&
    currentEmployee &&
    employeeActive(
      currentEmployee
    )
  );
}


/* ============================================================
   GLOBAL ERROR HANDLING
   ============================================================ */

window.addEventListener(
  "error",
  event => {

    console.error(
      "Application error:",
      event.error ||
      event.message
    );
  }
);


window.addEventListener(
  "unhandledrejection",
  event => {

    console.error(
      "Unhandled Firebase error:",
      event.reason
    );
  }
);


/* ============================================================
   FIREBASE STATUS
   ============================================================ */

window.firebaseStatus =
function() {

  return {

    connected:
      Boolean(
        currentUser
      ),

    user:
      currentUser?.uid ||
      null,

    store:
      currentStore?.code ||
      null,

    employee:
      currentEmployee?.employeeId ||
      null
  };
};


/* ============================================================
   END
   ============================================================ */

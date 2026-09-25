
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, runTransaction
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

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

const ADMIN_BOOTSTRAP_EMAIL = "sasco270@gmail.com";
const DEFAULT_MIN_QTY = {
  "Confectionery & Sweet Snacks": {B:180,C:80,A:220,D:50,Z:20,HR:60,MT:60,X:40},
  "Grocery - Food & Grocery - Non Food": {B:80,C:60,A:100,D:40,Z:5,HR:30,MT:30,X:40},
  "Beverages & Dairy & Salty Snacks & Frozen": {B:180,C:150,A:200,D:30,Z:30,HR:40,MT:40,X:60}
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let stores = {};
let employees = {};
let categories = {};
let storeCategories = {};
let categoryCycle = {};
let minQty = {};
let dataLookup = {};
let currentStore = null;
let currentEmployee = null;
let currentCategory = "";
let currentCycle = null;
let scannedProducts = [];
let submissionStatus = null;
let pasteAllowed = true;
let adminUser = null;
let realtimeStarted = false;

const $ = id => document.getElementById(id);
const key = value => String(value ?? "").trim()
  .replace(/[.#$[\]/]/g, "_")
  .replace(/\s+/g, "_");

function norm(value){ return String(value ?? "").trim().toLowerCase(); }
function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function safeJs(value){ return String(value ?? "").replaceAll("\\","\\\\").replaceAll("'","\\'"); }

function toast(message,type="info"){
  let el=$("toast");
  if(!el){
    el=document.createElement("div");
    el.id="toast";
    el.className="toast-notification";
    document.body.appendChild(el);
  }
  el.className="toast-notification show "+type;
  el.innerHTML=`<span>${escapeHtml(message)}</span><button class="toast-close" onclick="this.parentElement.className='toast-notification'">×</button>`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>el.className="toast-notification",5000);
}

function setSystemStatus(ok,text){
  const dot=$("statusDot"), st=$("statusText");
  if(dot) dot.className="status-dot "+(ok?"online":"offline");
  if(st) st.textContent=text;
  const top=$("firebaseTopStatus");
  if(top){top.textContent=text;top.className="status-chip "+(ok?"good":"bad");}
}

window.showOnly=function(id){
  ["landingPage","weeklyExpiryLoginPage","weeklyExpiryPage","adminPage"].forEach(x=>{
    const el=$(x); if(el) el.style.display=(x===id?"block":"none");
  });
}

window.openWeeklyExpiryMonitoring=()=>showOnly("weeklyExpiryLoginPage");
window.expiryBackToHome=()=>{showOnly("landingPage");resetLogin();};
window.goBackToHome=window.expiryBackToHome;

function resetLogin(){
  if($("expiryLoginStoreCode")) $("expiryLoginStoreCode").value="";
  if($("expiryLoginEmployeeId")) { $("expiryLoginEmployeeId").value=""; $("expiryLoginEmployeeId").disabled=true; }
  if($("expiryStoreVerifiedPanel")) $("expiryStoreVerifiedPanel").classList.remove("show");
  setLoginError("");
}

function setLoginError(msg){
  const el=$("expiryLoginError");
  if(!el)return;
  el.textContent=msg||"";
  el.style.display=msg?"block":"none";
}

async function ensureAnonymous(){
  if(auth.currentUser && auth.currentUser.isAnonymous) return auth.currentUser;
  if(auth.currentUser && !auth.currentUser.isAnonymous) return auth.currentUser;
  return signInAnonymously(auth).then(r=>r.user);
}

onAuthStateChanged(auth, async user=>{
  if(user){
    if(user.isAnonymous){
      setSystemStatus(true,"Firebase Connected");
    }else{
      adminUser=user;
      setSystemStatus(true,"Admin Authenticated");
    }
  }else{
    setSystemStatus(false,"Authentication Error");
  }
});

async function read(path){
  const snap=await get(ref(db,path));
  return snap.exists()?snap.val():null;
}

function activeAdmin(){
  return !!(adminUser && !adminUser.isAnonymous);
}

function adminCheck(){
  if(!activeAdmin()){ toast("Admin login required.","error"); return false; }
  return true;
}

/* ---------- Firebase realtime master data ---------- */

function startRealtime(){
  if(realtimeStarted)return;
  realtimeStarted=true;

  onValue(ref(db,"storeMaster"),s=>{stores=s.val()||{};});
  onValue(ref(db,"employeeMaster"),s=>{employees=s.val()||{};});
  onValue(ref(db,"categories"),s=>{categories=s.val()||{};});
  onValue(ref(db,"storeCategories"),s=>{storeCategories=s.val()||{};});
  onValue(ref(db,"categoryCycle"),s=>{categoryCycle=s.val()||{}; refreshCategoryDropdown();});
  onValue(ref(db,"minQty"),s=>{minQty=s.val()||{}; if(!Object.keys(minQty).length) minQty=DEFAULT_MIN_QTY; updateMinimumRequirementDisplay();});
  onValue(ref(db,"settings/barcodePasteAllowed"),s=>{pasteAllowed=s.exists()?s.val()!==false:true; applyBarcodePasteBehavior();});
  onValue(ref(db,"dataLookup"),s=>{dataLookup=s.val()||{};});
}
ensureAnonymous().then(()=>startRealtime()).catch(e=>{
  console.error(e);
  setSystemStatus(false,"Authentication Error");
});

/* ---------- Login: same transfer-friendly rule as original ---------- */

window.expiryVerifyStore=async function(){
  const code=$("expiryLoginStoreCode")?.value.trim();
  if(!code){setLoginError("Store Code is required.");return;}
  const store=findStore(code);
  if(!store){setLoginError("Store Code was not found in Firebase storeMaster.");return;}

  $("expiryVerifiedStoreName").textContent=store.name;
  $("expiryVerifiedStoreCode").textContent=store.code;
  $("expiryVerifiedStoreClass").textContent=store.classification||"C";
  $("expiryVerifiedStoreAM").textContent=store.areaManager||"Not Assigned";
  $("expiryVerifiedStoreOM").textContent=store.operationManager||"Not Assigned";
  $("expiryStoreVerifiedPanel").classList.add("show");
  $("expiryLoginEmployeeId").disabled=false;
  $("expiryLoginEmployeeId").focus();
  setLoginError("");
  toast(`Store verified: ${store.name} (${store.code})`,"success");
};

function findStore(code){
  const wanted=norm(code);
  const direct=stores[code] || stores[String(code)];
  if(direct)return normalizeStore(code,direct);
  for(const [k,v] of Object.entries(stores||{})){
    const s=v||{};
    if(norm(s.code||s.storeCode||k)===wanted)return normalizeStore(k,s);
  }
  return null;
}
function normalizeStore(code,s){
  return {
    ...s, code:String(s.code||s.storeCode||code),
    name:String(s.name||s.storeName||s.palmStore||code),
    classification:String(s.classification||s.storeType||"C"),
    areaManager:String(s.areaManager||""),
    operationManager:String(s.operationManager||""),
    region:String(s.region||""),location:String(s.location||""),
    email:String(s.email||"")
  };
}

function findEmployee(employeeId){
  const wanted=norm(employeeId);
  if(employees[employeeId])return normalizeEmployee(employeeId,employees[employeeId]);
  for(const [k,v] of Object.entries(employees||{})){
    if(norm(v?.employeeId||v?.id||k)===wanted)return normalizeEmployee(k,v);
  }
  return null;
}
function normalizeEmployee(id,e){
  return {
    ...e,
    employeeId:String(e.employeeId||e.id||id),
    employeeName:String(e.employeeName||e.name||""),
    status:String(e.status||"Active"),
    storeCode:String(e.storeCode||""),
    designation:String(e.designation||"")
  };
}
function employeeActive(e){
  return !e || /^(inactive|terminated|resigned|blocked|suspended|left)$/i.test(String(e.status||""));
}

window.expiryDoLogin=async function(){
  const storeCode=$("expiryLoginStoreCode")?.value.trim();
  const employeeId=$("expiryLoginEmployeeId")?.value.trim();
  if(!storeCode||!employeeId){setLoginError("Store Code and Employee ID are required.");return;}
  const store=findStore(storeCode);
  if(!store){setLoginError("Store Code was not found in Firebase.");return;}
  const emp=findEmployee(employeeId);
  if(!emp){setLoginError(`Employee ID ${employeeId} was not found in Firebase employeeMaster.`);return;}
  if(!employeeActive(emp)){setLoginError(`Employee ID ${employeeId} is not active (${emp.status}).`);return;}

  try{
    // Fresh anonymous identity = one working-store session.
    if(auth.currentUser) await signOut(auth);
    const anon=(await signInAnonymously(auth)).user;

    await set(ref(db,`storeSessions/${anon.uid}`),{
      storeCode:store.code,
      employeeId:emp.employeeId,
      loginAt:Date.now()
    });

    currentStore=store;
    currentEmployee=emp;
    sessionStorage.setItem("expiryStore",JSON.stringify(store));
    sessionStorage.setItem("expiryEmployee",JSON.stringify(emp));

    $("storeCodeInput").value=store.code;
    $("verifiedStoreName").textContent=store.name;
    $("verifiedStoreCode").textContent=store.code;
    $("verifiedStoreClass").textContent=store.classification;
    $("verifiedAreaManager").textContent=store.areaManager||"Not Assigned";
    $("verifiedOperationManager").textContent=store.operationManager||"Not Assigned";
    $("classificationBox").textContent="Class: "+(store.classification||"C");
    $("empId").value=emp.employeeId;
    $("expiryIdentityBadge").innerHTML=`<i class="fas fa-user-check"></i> ${escapeHtml(emp.employeeName||emp.employeeId)}`;

    showOnly("weeklyExpiryPage");
    refreshCategoryDropdown();
    applyBarcodePasteBehavior();
    loadSavedData();
    checkSubmissionStatus();
    toast("Store + Employee verified · Weekly Expiry opened","success");
  }catch(e){
    console.error(e);
    setLoginError("Login failed: "+(e.message||String(e)));
  }
};

function restoreSession(){
  try{
    const s=JSON.parse(sessionStorage.getItem("expiryStore")||"null");
    const e=JSON.parse(sessionStorage.getItem("expiryEmployee")||"null");
    if(s&&e){currentStore=s;currentEmployee=e;}
  }catch(_){}
}
restoreSession();

window.expiryLogoutAndHome=async function(){
  try{
    if(auth.currentUser?.isAnonymous) await signOut(auth);
  }catch(_){}
  currentStore=null;currentEmployee=null;scannedProducts=[];submissionStatus=null;
  sessionStorage.removeItem("expiryStore");sessionStorage.removeItem("expiryEmployee");
  resetLogin();showOnly("landingPage");renderAllRows();
  try{await signInAnonymously(auth);}catch(_){}
};

/* ---------- Category cycle + store assignment ---------- */

function cycleEntries(){
  return Object.entries(categoryCycle||{}).map(([id,v])=>({...v,_id:id})).filter(x=>x);
}
function parseDate(v){
  if(!v)return null;
  if(v instanceof Date)return v;
  const s=String(v).trim();
  const d=new Date(s);
  if(!isNaN(d))return d;
  const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  return null;
}
function currentActiveCycles(){
  const today=new Date();today.setHours(0,0,0,0);
  return cycleEntries().filter(c=>{
    const s=parseDate(c.start),e=parseDate(c.end);
    if(!s||!e)return false;
    e.setHours(23,59,59,999);
    return today>=s&&today<=e;
  });
}
function categoryAssigned(storeCode,category){
  const assigned=storeCategories?.[storeCode]||{};
  const exact=assigned[key(category)];
  if(exact===true)return true;
  // Support assignments stored by category name rather than safe key.
  return Object.entries(assigned).some(([k,v])=>v===true && norm(k)===norm(category));
}
function refreshCategoryDropdown(){
  const dd=$("categoryDropdown"); if(!dd)return;
  const previous=dd.value;
  dd.innerHTML="";
  if(!currentStore){
    dd.add(new Option("Verify Store first",""));
    return;
  }
  const active=currentActiveCycles();
  const seen=new Set();
  active.forEach(c=>{
    const cat=String(c.category||"").trim();
    if(!cat||seen.has(norm(cat))||!categoryAssigned(currentStore.code,cat))return;
    seen.add(norm(cat));dd.add(new Option(cat,cat));
  });
  if(!seen.size){
    const opt=new Option("No assigned active category","");opt.disabled=true;dd.add(opt);
  }else{
    if([...dd.options].some(o=>o.value===previous))dd.value=previous;
    else dd.selectedIndex=0;
  }
  onCategoryChange();
}
window.onCategoryChange=function(){
  currentCategory=$("categoryDropdown")?.value||"";
  currentCycle=getCurrentCycle(currentCategory);
  updateMinimumRequirementDisplay();
  if(currentStore&&currentCategory){loadSavedData();checkSubmissionStatus();}
  else {submissionStatus=null;updateSubmissionBanner();}
};
function getCurrentCycle(category){
  const active=currentActiveCycles().filter(c=>norm(c.category)===norm(category));
  if(!active.length)return null;
  active.sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  return active[active.length-1];
}
window.openCategoryCycleGuide=function(){
  const rows=currentActiveCycles().map(c=>`${c.category}: ${c.start} → ${c.end}`).join("\n");
  toast(rows||"No active category cycle today.","info");
};
window.openCategoryGuide=window.openCategoryCycleGuide;

/* ---------- Minimum quantity: same values/rule as original ---------- */

function getMinimumQuantity(category,classification){
  const req=minQty||DEFAULT_MIN_QTY;
  const exact=req[category];
  const cls=String(classification||"C").toUpperCase();
  if(exact && exact[cls]!=null)return Number(exact[cls])||0;
  if(exact){
    const first=Object.values(exact)[0];return Number(first)||0;
  }
  const lower=norm(category);
  for(const [k,v] of Object.entries(req)){
    const parts=k.split(" & ");
    if(parts.some(p=>lower.includes(norm(p))||norm(p).includes(lower))){
      if(v[cls]!=null)return Number(v[cls])||0;
    }
  }
  return 50;
}
function updateMinimumRequirementDisplay(){
  if(!currentStore||!currentCategory)return;
  const cls=currentStore.classification||"C";
  const min=getMinimumQuantity(currentCategory,cls);
  if($("minReqValue"))$("minReqValue").textContent=min;
  if($("minReqBox"))$("minReqBox").style.display="block";
  if($("currentCategory"))$("currentCategory").textContent=currentCategory;
  if($("reqCount"))$("reqCount").textContent=min;
  if($("requiredCount"))$("requiredCount").textContent=min;
  if($("currentCount"))$("currentCount").textContent=uniqueBarcodeCount();
  if($("minReqInfo"))$("minReqInfo").classList.add(uniqueBarcodeCount()>=min?"req-met":"req-not-met");
}
function uniqueBarcodeCount(){
  return new Set(scannedProducts.filter(x=>Number(x.Qty)>0&&x.ExpiryDate).map(x=>norm(x.barcode||x.sku))).size;
}

/* ---------- Product lookup: Firebase only ---------- */

function lookupKey(v){return key(v).toLowerCase();}
async function lookupProduct(code){
  const k=lookupKey(code);
  if(!k)return null;
  let p=await read(`dataLookup/byBarcode/${k}`);
  if(!p)p=await read(`dataLookup/bySku/${k}`);
  return p?normalizeProduct(p):null;
}
function normalizeProduct(p){
  const out={
    sku:String(p.sku||p.SKU||""),
    barcode:String(p.barcode||p.Barcodes||p.Barcode||""),
    uom:String(p.uom||p.UOM||"PCS"),
    description:String(p.description||p["EN Desc"]||p.Description||""),
    cost:Number(p.cost??p.Cost??0)||0,
    supplier:String(p.supplier||p["Default Supplier"]||p.Supplier||""),
    vendorCode:String(p.vendorCode||p["Vendor Code"]||p.VendorCode||""),
    category:String(p.category||p.Category||""),
    nonReturnable:String(p.nonReturnable||p["Non - Returnable & Returnable"]||p.NonReturnable||"No"),
    sourcePath:p.sourcePath||"",
    dataId:p.dataId||""
  };
  if(p._id!=null)out._id=String(p._id);
  if(p._sourcePath)out._sourcePath=String(p._sourcePath);
  if(p._isArray)out._isArray=true;
  return out;
}

window.handleScan=async function(code){
  code=String(code||"").trim();
  if(!code)return;
  if(!currentStore){toast("Please verify store first","warning");return;}
  if(!currentCategory){toast("Select category first","warning");return;}
  if(submissionStatus?.hasSubmitted){toast("This store has already submitted for this category. No more items can be added.","warning");return;}
  const input=$("barcodeInput");
  if(input){input.disabled=true;input.placeholder="Looking up barcode…";}
  try{
    const p=await lookupProduct(code);
    if(!p){
      toast("Item not found in Firebase Data. Contact Admin to add it to the master.","error");
      return;
    }
    if(norm(p.category)!==norm(currentCategory)){
      toast(`Item exists in "${p.category}". Today's category is "${currentCategory}".`,"error");
      return;
    }
    autoAddToTable(p);
  }catch(e){
    toast("Firebase product lookup failed: "+e.message,"error");
  }finally{
    if(input){input.disabled=false;input.placeholder=pasteAllowed?"Scan Barcode (paste allowed)":"Scan Barcode (paste disabled)";input.focus();}
  }
};

function autoAddToTable(item){
  const count=scannedProducts.filter(x=>norm(x.barcode||x.sku)===norm(item.barcode||item.sku)).length;
  if(count>=3){
    toast("Maximum 3 expiry dates allowed for the same barcode.","error");return;
  }
  const copy={...item,Qty:0,TotalCost:"0.00",ExpiryDate:"",DaysLeft:"",Status:"",StoreCode:currentStore.code,AreaManager:currentStore.areaManager,OperationManager:currentStore.operationManager};
  scannedProducts.push(copy);
  renderAllRows();
  updateSummary();
  const idx=scannedProducts.length-1;
  setTimeout(()=>{const q=$(`qty_${idx}`);if(q){q.focus();q.select();}},50);
}

function calculateDaysLeft(dateText){
  const d=parseDDMMYYYY(dateText);if(!d)return "";
  const today=new Date();today.setHours(0,0,0,0);
  return Math.floor((d-today)/86400000);
}
function parseDDMMYYYY(v){
  const s=String(v||"").trim();
  const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)return null;
  const d=new Date(+m[3],+m[2]-1,+m[1]);d.setHours(0,0,0,0);
  if(d.getFullYear()!=+m[3]||d.getMonth()!=+m[2]-1||d.getDate()!=+m[1])return null;
  return d;
}
function normalizeDate(v){
  if(!v)return "";
  if(v instanceof Date)return formatDDMMYYYY(v);
  const s=String(v).trim();
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))return s;
  const d=new Date(s);
  return isNaN(d)?"":formatDDMMYYYY(d);
}
function formatDDMMYYYY(d){
  return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear();
}
function validateExpiryDate(v){
  const d=parseDDMMYYYY(v);
  if(!d)return {valid:false,message:"Expiry date must be DD/MM/YYYY."};
  const min=new Date();min.setHours(0,0,0,0);min.setDate(min.getDate()-21);
  const max=new Date(2035,11,31);max.setHours(0,0,0,0);
  if(d<min)return {valid:false,message:`Expiry date cannot be older than 21 days. Earliest allowed date is ${formatDDMMYYYY(min)}.`};
  if(d>max)return {valid:false,message:"Expiry date cannot be after 31/12/2035."};
  return {valid:true};
}

function renderAllRows(){
  const tbody=$("dataTable")?.querySelector("tbody");if(!tbody)return;
  tbody.innerHTML="";
  scannedProducts.forEach((p,i)=>{
    const tr=document.createElement("tr");tr.id=`row_${i}`;
    const days=calculateDaysLeft(p.ExpiryDate);
    const status=days===""?"":days<0?"Expired":days<=7?"Critical":days<=14?"High":days<=30?"Near Expiry":"OK";
    p.DaysLeft=days;
    p.Status=status;
    p.TotalCost=(Number(p.Qty||0)*Number(p.cost||0)).toFixed(2);
    tr.innerHTML=`
      <td><input type="checkbox" class="row-check" data-index="${i}" onchange="updateSelectedCount()"></td>
      <td>${escapeHtml(p.sku)}</td>
      <td>${escapeHtml(p.barcode)}</td>
      <td>${escapeHtml(p.uom)}</td>
      <td>${escapeHtml(p.description)}</td>
      <td>${Number(p.cost||0).toFixed(2)}</td>
      <td>${escapeHtml(p.supplier)}</td>
      <td>${escapeHtml(p.vendorCode)}</td>
      <td>${escapeHtml(p.category)}</td>
      <td>${escapeHtml(p.nonReturnable)}</td>
      <td><input class="qty-input" id="qty_${i}" type="number" min="0" value="${Number(p.Qty||0)}" onchange="updateRow(${i},'qty',this.value)"></td>
      <td id="total_${i}">${p.TotalCost}</td>
      <td><input class="expiry-input" id="exp_${i}" maxlength="10" placeholder="DD/MM/YYYY" value="${escapeHtml(p.ExpiryDate||"")}" onchange="updateRow(${i},'expiry',this.value)"></td>
      <td class="${days!==""&&days<0?"expired":days!==""&&days<=30?"near":"ok"}">${days===""?"":days}</td>
      <td>${escapeHtml(status)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteRow(${i})"><i class="fas fa-trash"></i></button></td>`;
    tbody.appendChild(tr);
  });
  $("skuCountValue").textContent=scannedProducts.length;
  $("totalRecordsCount").textContent=scannedProducts.length;
  updateCurrentCount();
  updateSummary();
  updateSelectedCount();
}
window.updateRow=function(i,type,value){
  const p=scannedProducts[i];if(!p)return;
  if(type==="qty")p.Qty=Math.max(0,Number(value)||0);
  if(type==="expiry"){
    const normalized=normalizeDate(value);
    if(value && !normalized){toast("Expiry date must be DD/MM/YYYY.","error");return;}
    if(normalized){
      const check=validateExpiryDate(normalized);
      if(!check.valid){toast(check.message,"error");return;}
    }
    p.ExpiryDate=normalized;
  }
  renderAllRows();
  updateMinimumRequirementDisplay();
};
window.deleteRow=function(i){scannedProducts.splice(i,1);renderAllRows();};
window.toggleSelectAll=function(){
  const checked=$("selectAll")?.checked;
  document.querySelectorAll(".row-check").forEach(x=>x.checked=checked);
  updateSelectedCount();
};
window.updateSelectedCount=function(){
  const n=document.querySelectorAll(".row-check:checked").length;
  if($("selectedCount"))$("selectedCount").textContent=n+" selected";
};
window.bulkDelete=function(){
  const ids=[...document.querySelectorAll(".row-check:checked")].map(x=>Number(x.dataset.index)).sort((a,b)=>b-a);
  ids.forEach(i=>scannedProducts.splice(i,1));
  if($("selectAll"))$("selectAll").checked=false;
  renderAllRows();
};
window.bulkMarkComplete=function(){
  document.querySelectorAll(".row-check:checked").forEach(x=>{
    const i=Number(x.dataset.index),p=scannedProducts[i];if(p&&!p.Qty)p.Qty=1;
  });
  renderAllRows();toast("Selected items marked complete.","success");
};
window.filterExpiry=function(){
  const days=Number($("filterDays")?.value||30);
  scannedProducts.forEach((p,i)=>{
    const tr=$(`row_${i}`);if(!tr)return;
    tr.style.display=(p.DaysLeft!==""&&Number(p.DaysLeft)<=days)?"":"none";
  });
};
function updateSummary(){
  const total=scannedProducts.reduce((a,p)=>a+Number(p.TotalCost||0),0);
  if($("totalCost"))$("totalCost").textContent=total.toFixed(2);
}
function updateCurrentCount(){
  if($("currentCount"))$("currentCount").textContent=uniqueBarcodeCount();
  updateMinimumRequirementDisplay();
}

/* ---------- Save / submit ---------- */

function cycleKey(cycle){
  if(!cycle)return "no-cycle";
  return key(cycle._id || `${cycle.start||""}_${cycle.end||""}`).toLowerCase();
}
function draftPath(){
  return `expiryDrafts/${key(currentStore.code)}/${cycleKey(currentCycle)}/${key(currentCategory)}`;
}
function submissionPath(){
  return `storeSubmissions/${key(currentStore.code)}/${key(currentCategory)}/${cycleKey(currentCycle)}`;
}
function submissionPayload(status){
  return {
    storeCode:currentStore.code,storeName:currentStore.name,
    areaManager:currentStore.areaManager||"",operationManager:currentStore.operationManager||"",
    classification:currentStore.classification||"C",
    employeeId:currentEmployee.employeeId,employeeName:currentEmployee.employeeName||"",
    employeeMasterStore:currentEmployee.storeCode||"",
    assignmentStatus:currentEmployee.storeCode && norm(currentEmployee.storeCode)!==norm(currentStore.code)?"TRANSFER / TEMPORARY":"MATCHED",
    category:currentCategory,cycleStart:currentCycle?.start||"",cycleEnd:currentCycle?.end||"",
    status,items:scannedProducts.filter(x=>Number(x.Qty)>0&&x.ExpiryDate).map(x=>({...x,categoryKey:key(currentCategory)})),
    itemCount:uniqueBarcodeCount(),submittedAt:new Date().toISOString(),savedAt:new Date().toISOString()
  };
}
function validateBeforeSave(requireMinimum){
  if(!currentStore||!currentEmployee||!currentCategory){toast("Verified Store, Category & Employee ID are required.","warning");return false;}
  if(submissionStatus?.hasSubmitted){toast("This store has already submitted for this category. Cannot save new items.","warning");return false;}
  const items=scannedProducts.filter(x=>Number(x.Qty)>0&&x.ExpiryDate);
  if(!items.length){toast("No valid data. Add items with quantity and expiry date.","warning");return false;}
  for(const p of items){
    const v=validateExpiryDate(p.ExpiryDate);if(!v.valid){toast(`${p.sku||p.barcode}: ${v.message}`,"error");return false;}
  }
  if(requireMinimum){
    const min=getMinimumQuantity(currentCategory,currentStore.classification||"C");
    if(uniqueBarcodeCount()<min){
      toast(`Minimum not met!\nCategory: ${currentCategory}\nClass: ${currentStore.classification||"C"}\nRequired: ${min}\nCurrent: ${uniqueBarcodeCount()}`,"error");
      return false;
    }
  }
  return true;
}
window.saveData=async function(){
  if(!validateBeforeSave(false))return;
  const btn=$("saveBtn"),original=btn.innerHTML;btn.disabled=true;
  try{
    const payload=submissionPayload("DRAFT");
    await set(ref(db,draftPath()),payload);
    $("lastSaveTime").textContent=new Date().toLocaleString();
    updateDraftCard(payload);
    toast(`Store draft protected: ${payload.items.length} items saved successfully.`,"success");
  }catch(e){toast("Save failed: "+e.message,"error");}
  finally{btn.disabled=false;btn.innerHTML=original;}
};

window.submitData=async function(){
  if(!validateBeforeSave(true))return;
  if(!confirm("Are you sure you want to submit? This action cannot be undone."))return;
  const btn=$("weeklySubmitBtn"),original=btn.innerHTML;btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Submitting...';
  try{
    const path=submissionPath();
    const payload=submissionPayload("SUBMITTED");
    // Transaction enforces one final submission per Store + Category + Cycle.
    const result=await runTransaction(ref(db,path),current=>{
      if(current!==null)return;
      return payload;
    });
    if(!result.committed){toast("This store has already submitted for this category cycle.","error");return;}
    await remove(ref(db,draftPath())).catch(()=>{});
    submissionStatus={hasSubmitted:true,category:currentCategory,submittedBy:currentEmployee.employeeId,submissionDate:payload.submittedAt,itemCount:payload.itemCount};
    updateSubmissionBanner();
    updateSubmitButton();
    const csv=buildCsv(payload.items);
    downloadText(csv,`Expiry_Submission_${currentStore.code}_${currentCategory}_${new Date().toISOString().slice(0,10)}.csv`,"text/csv");
    scannedProducts=[];renderAllRows();toast("Store submission saved to Firebase successfully.","success");
  }catch(e){toast("Submission failed: "+e.message,"error");}
  finally{btn.disabled=false;btn.innerHTML=original;}
};

window.loadSavedData=async function(){
  if(!currentStore||!currentCategory)return;
  try{
    const data=await read(draftPath());
    if(data?.items?.length && !submissionStatus?.hasSubmitted){
      scannedProducts=(data.items||[]).map(x=>({...x,ExpiryDate:normalizeDate(x.ExpiryDate)}));
      renderAllRows();updateDraftCard(data);
      toast("Saved draft loaded for this Store + Category.","info");
    }else{
      updateDraftCard({items:[],savedQty:0,savedAt:""});
    }
  }catch(e){toast("Draft load failed: "+e.message,"error");}
}

function updateDraftCard(data){
  const items=data?.items||[];
  const qty=items.reduce((a,x)=>a+Number(x.Qty||0),0);
  const value=items.reduce((a,x)=>a+Number(x.Qty||0)*Number(x.cost||0),0);
  if($("expiryDraftItems"))$("expiryDraftItems").textContent=items.length;
  if($("expiryDraftQty"))$("expiryDraftQty").textContent=qty;
  if($("expiryDraftValue"))$("expiryDraftValue").textContent=value.toFixed(2);
  if($("expiryDraftLastSaved"))$("expiryDraftLastSaved").textContent=data?.savedAt?new Date(data.savedAt).toLocaleString():"—";
  if($("expiryDraftState"))$("expiryDraftState").textContent=items.length?`Saved safely for Store ${currentStore?.code||""} + ${currentCategory}`:"No saved draft yet for this Store + Category";
  if($("lastSaveTime")&&data?.savedAt)$("lastSaveTime").textContent=new Date(data.savedAt).toLocaleString();
}

async function checkSubmissionStatus(){
  if(!currentStore||!currentCategory)return;
  try{
    const data=await read(submissionPath());
    submissionStatus=data?{hasSubmitted:true,category:currentCategory,submittedBy:data.employeeId,submissionDate:data.submittedAt,itemCount:data.itemCount}: {hasSubmitted:false};
    updateSubmissionBanner();updateSubmitButton();
  }catch(e){console.warn(e);}
}
function updateSubmissionBanner(){
  const b=$("submissionStatusBanner");if(!b)return;
  if(!submissionStatus?.hasSubmitted){b.className="submission-status-banner";return;}
  b.className="submission-status-banner show submitted";
  $("submissionStatusIcon").textContent="✓";
  $("submissionStatusText").textContent=`Already submitted · ${currentCategory}`;
  $("submissionStatusDetails").textContent=`Items: ${submissionStatus.itemCount||0} · Employee: ${submissionStatus.submittedBy||""}`;
  $("submissionStatusDate").textContent=submissionStatus.submissionDate?new Date(submissionStatus.submissionDate).toLocaleString():"";
}
function updateSubmitButton(){
  const b=$("weeklySubmitBtn");if(!b)return;
  b.disabled=!!submissionStatus?.hasSubmitted;
  b.className=submissionStatus?.hasSubmitted?"btn btn-submit-disabled btn-sm":"btn btn-success btn-sm";
}
function buildCsv(items){
  const headers=["Store Code","Area Manager","Operation Manager","Category","SKU","Barcode","UOM","Description","Cost","Supplier","Vendor Code","NonReturnable","Qty","Total Cost","Expiry Date","Days Left","Status"];
  const esc=v=>{const s=String(v??"");return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
  const rows=[headers.map(esc).join(",")];
  items.forEach(p=>rows.push([
    currentStore.code,currentStore.areaManager,currentStore.operationManager,currentCategory,p.sku,p.barcode,p.uom,p.description,p.cost,p.supplier,p.vendorCode,p.nonReturnable,p.Qty,p.TotalCost,p.ExpiryDate,p.DaysLeft,p.Status
  ].map(esc).join(",")));
  return rows.join("\r\n");
}
function downloadText(text,name,type){
  const blob=new Blob([text],{type});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
window.printReport=function(){window.print();};

/* ---------- Paste setting ---------- */

function applyBarcodePasteBehavior(){
  const input=$("barcodeInput");if(!input)return;
  input.placeholder=pasteAllowed?"Scan Barcode (paste allowed)":"Scan Barcode (paste disabled)";
  if($("pasteStatusText"))$("pasteStatusText").textContent=pasteAllowed?"Barcode paste is allowed":"Barcode paste is disabled by Admin";
}
$("barcodeInput")?.addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();handleScan(e.currentTarget.value);e.currentTarget.value="";}
});
$("barcodeInput")?.addEventListener("change",e=>{
  if(e.target.value.trim()){handleScan(e.target.value);e.target.value="";}
});

/* ---------- Admin authentication ---------- */

window.openAdminLogin=function(){
  const email=prompt("Admin Email:",ADMIN_BOOTSTRAP_EMAIL);
  if(email===null)return;
  const password=prompt("Admin Password:");
  if(password===null)return;
  adminLogin(email,password);
};

async function adminLogin(email,password){
  try{
    const cred=await signInWithEmailAndPassword(auth,email.trim(),password);
    adminUser=cred.user;
    if(norm(email)!==norm(ADMIN_BOOTSTRAP_EMAIL)){
      const adminFlag=await read(`admins/${cred.user.uid}`);
      if(adminFlag!==true){await signOut(auth);await signInAnonymously(auth);throw new Error("This Firebase user is not an authorized admin.");}
    }else{
      // Bootstrap only this configured admin email. Rules permit this exact self-registration.
      await set(ref(db,`admins/${cred.user.uid}`),true);
    }
    showOnly("adminPage");
    loadAdminData();
    toast("Admin authenticated.","success");
  }catch(e){
    toast("Admin authentication failed: "+e.message,"error");
    try{if(!auth.currentUser?.isAnonymous)await signOut(auth);await signInAnonymously(auth);}catch(_){}
  }
}
window.adminLogout=async function(){
  adminUser=null;
  showOnly("landingPage");
  try{await signOut(auth);}catch(_){}
  try{await signInAnonymously(auth);}catch(_){}
};

/* ---------- Admin panel ---------- */

window.openAdminTab=function(tab,btn){
  document.querySelectorAll(".admin-section").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".admin-tab").forEach(x=>x.classList.remove("active"));
  const el=$("admin-"+tab);if(el)el.classList.add("active");
  if(btn)btn.classList.add("active");
  if(tab==="stores")renderAdminStores();
  if(tab==="employees")renderAdminEmployees();
  if(tab==="categories")renderAdminCategories();
  if(tab==="assignments"){renderAssignmentStores();renderAssignmentChecks();}
  if(tab==="cycle")renderAdminCycle();
  if(tab==="minqty")renderAdminMinQty();
  if(tab==="data")loadAdminDataMaster();
  if(tab==="settings")loadAdminSettings();
};

async function loadAdminData(){
  if(!adminCheck())return;
  await Promise.all([
    loadRootMaster("storeMaster"),loadRootMaster("employeeMaster"),loadRootMaster("categories"),
    loadRootMaster("storeCategories"),loadRootMaster("categoryCycle"),loadRootMaster("minQty")
  ]);
  renderAdminStores();renderAdminEmployees();renderAdminCategories();renderAssignmentStores();renderAssignmentChecks();renderAdminCycle();renderAdminMinQty();loadAdminSettings();
  updateAdminCounts();
}
async function loadRootMaster(path){
  try{
    const v=await read(path);
    if(path==="storeMaster")stores=v||{};
    if(path==="employeeMaster")employees=v||{};
    if(path==="categories")categories=v||{};
    if(path==="storeCategories")storeCategories=v||{};
    if(path==="categoryCycle")categoryCycle=v||{};
    if(path==="minQty")minQty=v||DEFAULT_MIN_QTY;
  }catch(e){toast(`Unable to load ${path}: ${e.message}`,"error");}
}
function updateAdminCounts(){
  if($("adminStoreCount"))$("adminStoreCount").textContent=Object.keys(stores).length;
  if($("adminEmployeeCount"))$("adminEmployeeCount").textContent=Object.keys(employees).length;
  if($("adminCategoryCount"))$("adminCategoryCount").textContent=Object.keys(categories).length;
  if($("adminProductCount"))$("adminProductCount").textContent="Index";
}

/* stores */
window.saveAdminStore=async function(){
  if(!adminCheck())return;
  const code=$("aStoreCode").value.trim();if(!code){toast("Store Code required","warning");return;}
  const obj={
    code,name:$("aStoreName").value.trim(),storeName:$("aStoreName").value.trim(),
    classification:$("aStoreClass").value.trim()||"C",areaManager:$("aStoreAM").value.trim(),
    operationManager:$("aStoreOM").value.trim(),region:$("aStoreRegion").value.trim(),
    location:$("aStoreLocation").value.trim(),email:$("aStoreEmail").value.trim(),active:true,updatedAt:new Date().toISOString()
  };
  await set(ref(db,`storeMaster/${key(code)}`),obj);clearStoreAdminForm();toast("Store saved.","success");
};
window.editAdminStore=function(code){
  const s=findStore(code);if(!s)return;
  $("aStoreCode").value=s.code;$("aStoreName").value=s.name;$("aStoreClass").value=s.classification;
  $("aStoreAM").value=s.areaManager;$("aStoreOM").value=s.operationManager;$("aStoreRegion").value=s.region;
  $("aStoreLocation").value=s.location;$("aStoreEmail").value=s.email;
};
window.deleteAdminStore=async function(code){if(!adminCheck())return;if(!confirm(`Delete Store ${code}?`))return;await remove(ref(db,`storeMaster/${key(code)}`));await remove(ref(db,`storeCategories/${key(code)}`));};
window.clearStoreAdminForm=function(){["aStoreCode","aStoreName","aStoreClass","aStoreAM","aStoreOM","aStoreRegion","aStoreLocation","aStoreEmail"].forEach(id=>$(id).value="");}
function renderAdminStores(){
  const b=$("adminStoresBody");if(!b)return;b.innerHTML="";
  Object.keys(stores).sort().forEach(code=>{
    const s=findStore(code),tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.areaManager)}</td><td>${escapeHtml(s.operationManager)}</td><td>${escapeHtml(s.classification)}</td><td><button class="btn btn-primary btn-xs" onclick="editAdminStore('${safeJs(s.code)}')">Edit</button> <button class="btn btn-danger btn-xs" onclick="deleteAdminStore('${safeJs(s.code)}')">Delete</button></td>`;
    b.appendChild(tr);
  });
}

/* employees */
window.saveAdminEmployee=async function(){
  if(!adminCheck())return;
  const id=$("aEmpId").value.trim();if(!id){toast("Employee ID required","warning");return;}
  const obj={employeeId:id,employeeName:$("aEmpName").value.trim(),status:$("aEmpStatus").value.trim()||"Active",storeCode:$("aEmpStore").value.trim(),designation:$("aEmpDesignation").value.trim(),updatedAt:new Date().toISOString()};
  await set(ref(db,`employeeMaster/${key(id)}`),obj);clearEmpForm();toast("Employee saved.","success");
};
window.editAdminEmployee=function(id){
  const e=findEmployee(id);if(!e)return;
  $("aEmpId").value=e.employeeId;$("aEmpName").value=e.employeeName;$("aEmpStatus").value=e.status;$("aEmpStore").value=e.storeCode;$("aEmpDesignation").value=e.designation;
};
window.deleteAdminEmployee=async function(id){if(!adminCheck())return;if(!confirm("Delete employee?"))return;await remove(ref(db,`employeeMaster/${key(id)}`));};
window.clearEmpForm=function(){["aEmpId","aEmpName","aEmpStatus","aEmpStore","aEmpDesignation"].forEach(id=>$(id).value="");}
function renderAdminEmployees(){
  const b=$("adminEmployeesBody");if(!b)return;b.innerHTML="";
  Object.keys(employees).sort().forEach(id=>{
    const e=findEmployee(id),tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(e.employeeId)}</td><td>${escapeHtml(e.employeeName)}</td><td>${escapeHtml(e.status)}</td><td>${escapeHtml(e.storeCode)}</td><td>${escapeHtml(e.designation)}</td><td><button class="btn btn-primary btn-xs" onclick="editAdminEmployee('${safeJs(e.employeeId)}')">Edit</button> <button class="btn btn-danger btn-xs" onclick="deleteAdminEmployee('${safeJs(e.employeeId)}')">Delete</button></td>`;
    b.appendChild(tr);
  });
}

/* categories */
window.saveAdminCategory=async function(){
  if(!adminCheck())return;
  const name=$("aCategoryName").value.trim();if(!name){toast("Category name required","warning");return;}
  const k=key(name);
  await set(ref(db,`categories/${k}`),{name,active:true,updatedAt:new Date().toISOString()});
  $("aCategoryName").value="";toast("Category saved.","success");
};

window.renameAdminCategory=async function(k){
  if(!adminCheck())return;
  const c=categories[k]||{}, oldName=typeof c==="string"?c:c.name||k;
  const name=prompt("New category name:",oldName);
  if(!name||!name.trim()||norm(name)===norm(oldName))return;
  const newKey=key(name);
  await set(ref(db,`categories/${newKey}`),{...(typeof c==="object"?c:{}),name:name.trim(),active:true,updatedAt:new Date().toISOString()});
  await remove(ref(db,`categories/${k}`));
  // Migrate store assignments.
  const updates={};
  Object.entries(storeCategories||{}).forEach(([store,assigned])=>{
    if(assigned?.[k]===true){
      updates[`storeCategories/${store}/${newKey}`]=true;
      updates[`storeCategories/${store}/${k}`]=null;
    }
  });
  if(Object.keys(updates).length)await update(ref(db),updates);
  // Migrate cycle category labels.
  const cycUpdates={};
  Object.entries(categoryCycle||{}).forEach(([id,cx])=>{
    if(norm(cx?.category)===norm(oldName))cycUpdates[`categoryCycle/${id}/category`]=name.trim();
  });
  if(Object.keys(cycUpdates).length)await update(ref(db),cycUpdates);
  toast("Category renamed and assignments migrated.","success");
};

window.deleteAdminCategory=async function(k){if(!adminCheck())return;if(!confirm("Delete category?"))return;await remove(ref(db,`categories/${k}`));};
function renderAdminCategories(){
  const b=$("adminCategoriesBody");if(!b)return;b.innerHTML="";
  Object.keys(categories).sort().forEach(k=>{
    const c=categories[k]||{},name=typeof c==="string"?c:c.name||k,active=typeof c==="string"||c.active!==false;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(k)}</td><td>${escapeHtml(name)}</td><td>${active?"Active":"Inactive"}</td><td><button class="btn btn-danger btn-xs" onclick="deleteAdminCategory('${safeJs(k)}')">Delete</button></td>`;
    b.appendChild(tr);
  });
}

/* assignments */
function renderAssignmentStores(){
  const s=$("assignmentStore");if(!s)return;
  const old=s.value;s.innerHTML='<option value="">Select Store</option>';
  Object.keys(stores).sort().forEach(code=>{const st=findStore(code);s.add(new Option(`${st.code} - ${st.name}`,st.code));});
  if(old)s.value=old;
}
window.renderAssignmentChecks=function(){
  const box=$("assignmentChecks"),store=$("assignmentStore")?.value;if(!box)return;
  box.innerHTML=store?"":"Select Store";
  if(!store)return;
  const assigned=storeCategories[store]||{};
  Object.keys(categories).sort().forEach(k=>{
    const c=categories[k]||{},name=typeof c==="string"?c:c.name||k;
    if(typeof c!=="string"&&c.active===false)return;
    const checked=assigned[k]===true||assigned[name]===true;
    const row=document.createElement("label");row.className="check-row";
    row.innerHTML=`<input type="checkbox" value="${escapeHtml(k)}" ${checked?"checked":""}> <span>${escapeHtml(name)}</span>`;
    box.appendChild(row);
  });
};
window.saveStoreAssignments=async function(){
  if(!adminCheck())return;
  const store=$("assignmentStore").value;if(!store){toast("Select Store","warning");return;}
  const out={};document.querySelectorAll("#assignmentChecks input:checked").forEach(x=>out[x.value]=true);
  await set(ref(db,`storeCategories/${key(store)}`),out);toast("Store category assignment saved.","success");
};

/* category cycle */
window.addCycleRow=function(){
  const tbody=$("cycleBody"),tr=document.createElement("tr");
  tr.innerHTML=`<td><input class="cycle-sno" value="${tbody.children.length+1}"></td><td><select class="cycle-cat">${categoryOptions()}</select></td><td><input class="cycle-start" type="date"></td><td><input class="cycle-end" type="date"></td><td><button class="btn btn-danger btn-xs" onclick="this.closest('tr').remove()">Delete</button></td>`;
  tbody.appendChild(tr);
};
function categoryOptions(){
  return `<option value="">Select</option>`+Object.entries(categories).map(([k,v])=>`<option value="${escapeHtml(typeof v==="string"?v:v.name||k)}">${escapeHtml(typeof v==="string"?v:v.name||k)}</option>`).join("");
}
function renderAdminCycle(){
  const b=$("cycleBody");if(!b)return;b.innerHTML="";
  cycleEntries().sort((a,b)=>String(a.start).localeCompare(String(b.start))).forEach((c,i)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><input class="cycle-sno" value="${escapeHtml(c.sno||i+1)}"></td><td><select class="cycle-cat">${categoryOptions()}</select></td><td><input class="cycle-start" type="date" value="${escapeHtml(c.start||"")}"></td><td><input class="cycle-end" type="date" value="${escapeHtml(c.end||"")}"></td><td><button class="btn btn-danger btn-xs" onclick="this.closest('tr').remove()">Delete</button></td>`;
    b.appendChild(tr);tr.querySelector(".cycle-cat").value=c.category||"";
  });
}
window.saveCycle=async function(){
  if(!adminCheck())return;
  const out={};[...document.querySelectorAll("#cycleBody tr")].forEach((tr,i)=>{
    const category=tr.querySelector(".cycle-cat").value,start=tr.querySelector(".cycle-start").value,end=tr.querySelector(".cycle-end").value;
    if(category&&start&&end)out["cycle_"+String(i+1).padStart(3,"0")]={sno:tr.querySelector(".cycle-sno").value||String(i+1),category,start,end,updatedAt:new Date().toISOString()};
  });
  await set(ref(db,"categoryCycle"),out);toast("Category cycle saved.","success");
};

/* min qty */
function renderAdminMinQty(){
  const b=$("minQtyBody");if(!b)return;b.innerHTML="";
  const req=minQty&&Object.keys(minQty).length?minQty:DEFAULT_MIN_QTY;
  Object.entries(req).forEach(([cat,vals])=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(cat)}</td>`+["A","B","C","D","Z","HR","MT","X"].map(c=>`<td><input class="minq" data-cat="${escapeHtml(cat)}" data-cls="${c}" type="number" min="0" value="${Number(vals?.[c]??0)}"></td>`).join("")+`<td><button class="btn btn-danger btn-xs" onclick="deleteMinQty('${safeJs(cat)}')">Delete</button></td>`;
    b.appendChild(tr);
  });
}
window.addMinQtyRow=function(){
  const name=prompt("Category name:");if(!name)return;
  if(!minQty)minQty={};minQty[name]={A:0,B:0,C:0,D:0,Z:0,HR:0,MT:0,X:0};renderAdminMinQty();
};
window.deleteMinQty=function(cat){if(confirm(`Delete ${cat}?`)){delete minQty[cat];renderAdminMinQty();}};
window.saveMinQty=async function(){
  if(!adminCheck())return;
  const out={};document.querySelectorAll("#minQtyBody tr").forEach(tr=>{
    const cat=tr.querySelector(".minq")?.dataset.cat;if(!cat)return;
    out[cat]=out[cat]||{};
    tr.querySelectorAll(".minq").forEach(x=>out[cat][x.dataset.cls]=Math.max(0,Number(x.value)||0));
  });
  await set(ref(db,"minQty"),out);minQty=out;toast("Minimum quantity requirements saved.","success");
};

/* data master + index */
let adminProducts={};
let adminDataHeaders=[];
async function loadAdminDataMaster(){
  if(!adminCheck())return;
  try{
    const raw=await read("Data");
    adminDataHeaders=Array.isArray(raw?.headers)?raw.headers:[];
    adminProducts=normalizeFirebaseData(raw||{});
    renderAdminData();
  }catch(e){toast("Data master load failed: "+e.message,"error");}
}
function normalizeFirebaseData(data){
  const headers=Array.isArray(data?.headers)?data.headers:[];
  const out={};
  const add=(id,row,sourcePath)=>{
    if(!row)return;
    let p;
    if(Array.isArray(row)){
      p={};headers.forEach((h,i)=>p[String(h)]=row[i]);
      p._isArray=true;
    }else p={...row};
    if(!(p.SKU||p.sku||p.Barcodes||p.Barcode))return;
    p._id=String(id);p._sourcePath=sourcePath;
    out[p._id]=normalizeProduct(p);
  };
  if(data?.items&&typeof data.items==="object")Object.entries(data.items).forEach(([id,row])=>add(id,row,`Data/items/${id}`));
  Object.entries(data).forEach(([id,row])=>{
    if(id==="headers"||id==="items")return;
    add(id,row,`Data/${id}`);
  });
  return out;
}
window.filterAdminData=function(){renderAdminData();};
function renderAdminData(){
  const b=$("adminDataBody");if(!b)return;b.innerHTML="";
  const q=norm($("adminDataSearch")?.value);
  let n=0;
  Object.values(adminProducts).forEach(p=>{
    if(n>=500)return;
    if(q&&!`${p.sku} ${p.barcode} ${p.description} ${p.category}`.toLowerCase().includes(q))return;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(p.sku)}</td><td>${escapeHtml(p.barcode)}</td><td>${escapeHtml(p.description)}</td><td>${escapeHtml(p.uom)}</td><td>${Number(p.cost||0).toFixed(2)}</td><td>${escapeHtml(p.supplier)}</td><td>${escapeHtml(p.vendorCode)}</td><td>${escapeHtml(p.category)}</td><td><button class="btn btn-primary btn-xs" onclick="editAdminProduct('${safeJs(p._id)}')">Edit</button> <button class="btn btn-danger btn-xs" onclick="deleteAdminProduct('${safeJs(p._id)}')">Delete</button></td>`;
    b.appendChild(tr);n++;
  });
}
window.editAdminProduct=function(id){
  const p=adminProducts[id];if(!p)return;
  $("dId").value=p._id;$("dSku").value=p.sku;$("dBarcode").value=p.barcode;$("dUom").value=p.uom;$("dDesc").value=p.description;$("dCost").value=p.cost;$("dSupplier").value=p.supplier;$("dVendor").value=p.vendorCode;$("dCategory").value=p.category;$("dReturnable").value=p.nonReturnable;
};
window.saveAdminProduct=async function(){
  if(!adminCheck())return;
  const sku=$("dSku").value.trim();if(!sku){toast("SKU required","warning");return;}
  const id=$("dId").value.trim()||key(sku);
  const product={
    SKU:sku,
    Barcodes:$("dBarcode").value.trim(),
    UOM:$("dUom").value.trim()||"PCS",
    "EN Desc":$("dDesc").value.trim(),
    Cost:Number($("dCost").value)||0,
    "Default Supplier":$("dSupplier").value.trim(),
    "Vendor Code":$("dVendor").value.trim(),
    Category:$("dCategory").value.trim(),
    "Non - Returnable & Returnable":$("dReturnable").value.trim()||"No",
    Qty:0,
    "Total Cost":0,
    "Expiry Date":"",
    "Days Left":"",
    updatedAt:new Date().toISOString()
  };
  let path=`Data/items/${id}`;
  if(adminProducts[id]?._sourcePath)path=adminProducts[id]._sourcePath;
  let writeValue=product;
  if(adminProducts[id]?._isArray && adminDataHeaders.length){
    writeValue=adminDataHeaders.map(h=>{
      const v=String(h||"");
      const map={
        "SKU":product.SKU,"Barcodes":product.Barcodes,"UOM":product.UOM,
        "EN Desc":product["EN Desc"],"Cost":product.Cost,
        "Default Supplier":product["Default Supplier"],"Vendor Code":product["Vendor Code"],
        "Category":product.Category,"Non - Returnable & Returnable":product["Non - Returnable & Returnable"],
        "Qty":product.Qty,"Total Cost":product["Total Cost"],"Expiry Date":product["Expiry Date"],"Days Left":product["Days Left"]
      };
      return map[v]!==undefined?map[v]:"";
    });
  }
  await set(ref(db,path),writeValue);
  await updateDataLookup(normalizeProduct({...product,dataId:id,sourcePath:path}),id,path);
  clearDataForm();await loadAdminDataMaster();toast("Firebase Data item saved and lookup updated.","success");
};
window.deleteAdminProduct=async function(id){
  if(!adminCheck())return;const p=adminProducts[id];if(!p)return;if(!confirm("Delete this item?"))return;
  if(p._sourcePath)await remove(ref(db,p._sourcePath));
  await remove(ref(db,`dataLookup/bySku/${lookupKey(p.sku)}`));
  for(const b of String(p.barcode||"").split(/[,;|\/]+/).map(x=>x.trim()).filter(Boolean))await remove(ref(db,`dataLookup/byBarcode/${lookupKey(b)}`));
  await loadAdminDataMaster();
};
window.clearDataForm=function(){["dId","dSku","dBarcode","dUom","dDesc","dCost","dSupplier","dVendor","dCategory","dReturnable"].forEach(id=>$(id).value="");}
async function updateDataLookup(p,id,sourcePath){
  const base={...p,dataId:id,sourcePath};
  const writes={};
  if(p.sku)writes[`dataLookup/bySku/${lookupKey(p.sku)}`]=base;
  String(p.barcode||"").split(/[,;|\/]+/).map(x=>x.trim()).filter(Boolean).forEach(b=>writes[`dataLookup/byBarcode/${lookupKey(b)}`]=base);
  await update(ref(db),writes);
}
window.buildDataIndex=async function(){
  if(!adminCheck())return;
  if(!confirm("Build Firebase barcode/SKU lookup from the current /Data master? This reads the existing Firebase Data once and creates lookup entries."))return;
  const raw=await read("Data"), items=normalizeFirebaseData(raw||{});
  let writes={}, count=0, paths=0;
  async function flush(){
    if(!paths)return;
    await update(ref(db),writes);
    writes={};paths=0;
  }
  for(const p of Object.values(items)){
    const base={...p};delete base._id;delete base._sourcePath;
    if(p.sku){writes[`dataLookup/bySku/${lookupKey(p.sku)}`]=base;paths++;}
    String(p.barcode||"").split(/[,;|\/]+/).map(x=>x.trim()).filter(Boolean).forEach(b=>{
      writes[`dataLookup/byBarcode/${lookupKey(b)}`]=base;paths++;
    });
    count++;
    if(paths>=1000)await flush();
  }
  await flush();
  toast(`Lookup built for ${count} Data items.`,"success");
};

/* settings */
async function loadAdminSettings(){
  const v=await read("settings/barcodePasteAllowed");
  pasteAllowed=v===null?true:v!==false;
  if($("pasteToggle"))$("pasteToggle").checked=pasteAllowed;
}
window.savePasteSetting=async function(){
  if(!adminCheck())return;
  const v=$("pasteToggle").checked;await set(ref(db,"settings/barcodePasteAllowed"),v);pasteAllowed=v;applyBarcodePasteBehavior();toast("Barcode paste setting saved.","success");
};

/* boot keyboard shortcuts */
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && $("weeklyExpiryPage")?.style.display==="block"){}
});

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getDatabase, ref, get, set, update, remove, runTransaction } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:"AIzaSyDXtkoz1xSpsWYuMV-wvm57TF0ajj0p9M9",
  authDomain:"expiry-monitoring-v2.firebaseapp.com",
  projectId:"expiry-monitoring-v2",
  storageBucket:"expiry-monitoring-v2.firebasestorage.app",
  messagingSenderId:"722745088244",
  appId:"1:722745088244:web:17a4f2854a98ee6f6366a1",
  measurementId:"G-YPXSVPRK36",
  databaseURL:"https://expiry-monitoring-v2-default-rtdb.firebaseio.com"
};

const ADMIN_EMAIL="sasco270@gmail.com";
const app=initializeApp(firebaseConfig), db=getDatabase(app), auth=getAuth(app);
let stores={}, employees={}, categories={}, storeCategories={}, cycles={}, products={};
let currentStore=null,currentEmployee=null,currentCategory="",currentCycle=null,rows=[],submitted=false,adminUser=null;

const $=id=>document.getElementById(id);
const clean=v=>String(v??"").trim();
const norm=v=>clean(v).toLowerCase();
const key=v=>clean(v).replace(/[.#$[\]/]/g,"_").replace(/\s+/g,"_");
const esc=v=>clean(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const toast=(m,type="info")=>{const el=$("monitorMessage");if(el){el.textContent=m;el.className=type==="error"?"error":"info";el.classList.remove("hidden");}};

function setStatus(ok,msg){$("statusDot").className="dot"+(ok?" ok":"");$("statusText").textContent=msg;}
async function read(path){const s=await get(ref(db,path));return s.exists()?s.val():null;}

async function start(){
  try{
    await signInAnonymously(auth);
    setStatus(true,"Firebase Connected");
    stores=await read("storeMaster")||{};
    employees=normalizeEmployees(await read("EmpData")||{});
    categories=await read("categories")||{};
    storeCategories=await read("storeCategories")||{};
    cycles=await read("categoryCycle")||{};
    products=await loadProducts();
  }catch(e){console.error(e);setStatus(false,"Firebase Error: "+e.message);}
}
start();

function normalizeStore(id,v){
  v=v||{};
  return {code:clean(v.code||v.storeCode||id),name:clean(v.name||v.storeName||v.palmStore||id),classification:clean(v.classification||v.storeType||"C"),areaManager:clean(v.areaManager),operationManager:clean(v.operationManager),region:clean(v.region),...v};
}
function findStore(code){
  const c=norm(code);
  if(stores[code])return normalizeStore(code,stores[code]);
  for(const [id,v] of Object.entries(stores)){const s=normalizeStore(id,v);if(norm(s.code)===c)return s;}
  return null;
}
function normalizeEmployees(root){
  const out={};
  if(Array.isArray(root)){root.forEach((v,i)=>{if(v&&typeof v==="object"){const id=clean(v.employeeId||v["Employee ID"]||v.empId||i);out[id]=normalizeEmployee(id,v);}});return out;}
  if(root.items){for(const [id,v] of Object.entries(root.items))if(v&&typeof v==="object")out[id]=normalizeEmployee(id,v);}
  for(const [id,v] of Object.entries(root)){if(["items","headers","meta","metadata"].includes(id))continue;if(v&&typeof v==="object")out[id]=normalizeEmployee(id,v);}
  return out;
}
function normalizeEmployee(id,v){
  v=v||{};
  return {employeeId:clean(v.employeeId||v.employeeID||v.empId||v.EmpID||v["Employee ID"]||v["EmployeeID"]||v["Emp ID"]||id),employeeName:clean(v.employeeName||v.name||v["Employee Name"]||v["EmployeeName"]||v["Name"]),status:clean(v.status||v.employeeStatus||v["Employee Status"]||v["Employment Status"]||v["Status"]||"Active"),storeCode:clean(v.storeCode||v["Store Code"]||v["StoreCode"]||v.Store),designation:clean(v.designation||v["Designation"]||v["Job Title"]||v["Position"]||""),...v};
}
function employeeActive(e){return !/inactive|terminated|resigned|blocked|suspended|left/i.test(clean(e.status));}

window.openWeeklyExpiryMonitoring=()=>{hideAll();$("loginPage").classList.remove("hidden");};
window.goHome=()=>{hideAll();$("homePage").classList.remove("hidden");};
function hideAll(){["homePage","loginPage","monitorPage","adminPage"].forEach(id=>$(id).classList.add("hidden"));}

window.verifyStore=()=>{
  const s=findStore($("storeCode").value);
  if(!s){showLoginError("Store Code was not found in Firebase storeMaster.");return;}
  $("storeInfo").innerHTML=[["Store",s.name],["Store Code",s.code],["Classification",s.classification],["Area Manager",s.areaManager||"Not Assigned"],["Operation Manager",s.operationManager||"Not Assigned"]].map(x=>`<div class="mini"><span>${esc(x[0])}</span><b>${esc(x[1])}</b></div>`).join("");
  $("storeInfo").classList.remove("hidden");$("employeeId").disabled=false;$("employeeId").focus();$("loginError").classList.add("hidden");
  currentStore=s;
};
function showLoginError(m){$("loginError").textContent=m;$("loginError").classList.remove("hidden");}

window.loginStore=async()=>{
  const s=findStore($("storeCode").value), id=clean($("employeeId").value);
  if(!s){showLoginError("Verify Store Code first.");return;}
  const e=Object.values(employees).find(x=>norm(x.employeeId)===norm(id));
  if(!e){showLoginError("Employee ID was not found in Firebase EmpData.");return;}
  if(!employeeActive(e)){showLoginError(`Employee ${id} is not active.`);return;}
  try{
    if(auth.currentUser)await signOut(auth);
    const u=(await signInAnonymously(auth)).user;
    await set(ref(db,"storeSessions/"+u.uid),{storeCode:s.code,employeeId:e.employeeId,loginAt:Date.now()});
    currentStore=s;currentEmployee=e;sessionStorage.setItem("expirySession",JSON.stringify({store:s,employee:e}));
    hideAll();$("monitorPage").classList.remove("hidden");
    $("identityText").textContent=`Store ${s.code} · ${s.name} · Employee ${e.employeeId}${e.employeeName?" · "+e.employeeName:""}`;
    loadCategories();toast("Store and employee verified successfully.","info");
  }catch(err){showLoginError("Login failed: "+err.message);}
};

window.logoutStore=async()=>{rows=[];currentStore=null;currentEmployee=null;submitted=false;sessionStorage.removeItem("expirySession");try{await signOut(auth);await signInAnonymously(auth);}catch(e){}goHome();renderRows();};

function activeCycles(){
  const now=new Date();now.setHours(0,0,0,0);
  return Object.entries(cycles||{}).map(([id,v])=>({...v,_id:id})).filter(c=>{
    const s=new Date(c.start),e=new Date(c.end);e.setHours(23,59,59,999);
    return !isNaN(s)&&!isNaN(e)&&now>=s&&now<=e;
  });
}
function assigned(cat){
  const a=storeCategories?.[currentStore.code]||{};
  return a[key(cat)]===true||Object.entries(a).some(([k,v])=>v===true&&norm(k)===norm(cat));
}
function loadCategories(){
  const select=$("categorySelect");select.innerHTML='<option value="">Select Category</option>';
  const names=new Set();
  activeCycles().forEach(c=>{const cat=clean(c.category);if(cat&&assigned(cat)&&!names.has(norm(cat))){names.add(norm(cat));select.add(new Option(cat,cat));}});
  if(!names.size){
    Object.values(categories||{}).forEach(c=>{const cat=clean(c.name||c.category||c.title||c);if(cat&&!names.has(norm(cat))){names.add(norm(cat));select.add(new Option(cat,cat));}});
  }
  if(select.options.length===1)select.add(new Option("No category assigned",""));
}
window.categoryChanged=async()=>{
  currentCategory=$("categorySelect").value;
  currentCycle=activeCycles().find(c=>norm(c.category)===norm(currentCategory))||null;
  const min=getMinQty();
  $("categoryText").textContent=currentCategory||"—";$("minimumText").textContent=min;
  rows=[];renderRows();
  if(currentCategory){const p=`expiryDrafts/${key(currentStore.code)}/${key(currentCategory)}`;const d=await read(p);if(d?.items)rows=d.items;const sub=await read(`storeSubmissions/${key(currentStore.code)}/${key(currentCategory)}`);submitted=!!sub;updateSubmit();renderRows();}
};

function getMinQty(){
  const cls=clean(currentStore?.classification||"C").toUpperCase();
  const m=readMinQtySync(currentCategory);
  return Number(m?.[cls]??m?.C??50)||50;
}
let minQtyCache=null;
async function getMinQtyAsync(){minQtyCache=await read("minQty")||{};return getMinQty();}
function readMinQtySync(cat){return (minQtyCache||{})[cat]||{};}

async function loadProducts(){
  const root=await read("Data");const out={};if(!root)return out;
  const headers=Array.isArray(root.headers)?root.headers:null;
  const add=(id,v)=>{
    if(Array.isArray(v)&&headers){const o={};headers.forEach((h,i)=>o[h]=v[i]??"");out[id]=product(o,id);}
    else if(v&&typeof v==="object")out[id]=product(v,id);
  };
  if(root.items)Object.entries(root.items).forEach(([id,v])=>add(id,v));
  Object.entries(root).forEach(([id,v])=>{if(!["items","headers","meta","metadata"].includes(id))add(id,v);});
  return out;
}
function product(v,id){
  return {id,sku:clean(v.sku||v.SKU),barcode:clean(v.barcode||v.Barcodes||v.Barcode),uom:clean(v.uom||v.UOM||"PCS"),description:clean(v.description||v["EN Desc"]||v.Description),cost:Number(v.cost??v.Cost??0)||0,supplier:clean(v.supplier||v["Default Supplier"]||v.Supplier),vendor:clean(v.vendor||v["Vendor Code"]||v.VendorCode),category:clean(v.category||v.Category),returnable:clean(v.returnable||v["Non - Returnable & Returnable"]||"No"),...v};
}
function lookupInMaster(code){
  const c=norm(code);
  return Object.values(products).find(p=>norm(p.sku)===c||String(p.barcode).split(/[,;|/]+/).map(norm).includes(c))||null;
}
async function lookupProduct(code){
  const k=key(code).toLowerCase();
  let p=await read("dataLookup/byBarcode/"+k)||await read("dataLookup/bySku/"+k);
  if(p)return product(p,p.id||"");
  return lookupInMaster(code);
}
window.lookupAndAdd=async()=>{
  const code=clean($("barcodeInput").value);if(!code)return;
  if(!currentStore||!currentCategory){toast("Verify the store and select a category first.","error");return;}
  if(submitted){toast("This category has already been submitted.","error");return;}
  const p=await lookupProduct(code);
  if(!p){toast("Item not found in Firebase Data master.","error");return;}
  if(norm(p.category)!==norm(currentCategory)){toast(`Item category is "${p.category}", not "${currentCategory}".`,"error");return;}
  if(rows.filter(x=>norm(x.barcode||x.sku)===norm(p.barcode||p.sku)).length>=3){toast("Maximum 3 expiry dates allowed for the same barcode.","error");return;}
  rows.push({...p,Qty:0,ExpiryDate:""});$("barcodeInput").value="";renderRows();
};
$("barcodeInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();lookupAndAdd();}});

function daysLeft(v){
  const m=clean(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return "";
  const d=new Date(+m[3],+m[2]-1,+m[1]);d.setHours(0,0,0,0);if(isNaN(d))return "";
  const t=new Date();t.setHours(0,0,0,0);return Math.floor((d-t)/86400000);
}
function validDate(v){
  if(!/^\d{2}\/\d{2}\/\d{4}$/.test(clean(v)))return false;
  return daysLeft(v)!=="";
}
function renderRows(){
  const body=document.querySelector("#itemsTable tbody");body.innerHTML="";
  let qty=0,cost=0;const uniq=new Set();
  rows.forEach((p,i)=>{
    const q=Number(p.Qty)||0,d=daysLeft(p.ExpiryDate);qty+=q;cost+=q*(Number(p.cost)||0);if(q>0&&p.ExpiryDate)uniq.add(norm(p.barcode||p.sku));
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${i+1}</td><td>${esc(p.sku)}</td><td>${esc(p.barcode)}</td><td>${esc(p.uom)}</td><td>${esc(p.description)}</td><td>${Number(p.cost||0).toFixed(2)}</td><td>${esc(p.supplier)}</td><td>${esc(p.vendor)}</td><td>${esc(p.category)}</td><td><input class="qty" type="number" min="0" value="${q}" data-i="${i}" data-k="Qty"></td><td><input value="${esc(p.ExpiryDate)}" placeholder="DD/MM/YYYY" data-i="${i}" data-k="ExpiryDate"></td><td>${d}</td><td>${(q*(Number(p.cost)||0)).toFixed(2)}</td><td><button class="danger" onclick="removeRow(${i})">×</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll("input").forEach(inp=>inp.addEventListener("change",()=>{const i=+inp.dataset.i;if(inp.dataset.k==="Qty")rows[i].Qty=Math.max(0,Number(inp.value)||0);else{if(inp.value&&!validDate(inp.value)){toast("Expiry must be DD/MM/YYYY.","error");return;}rows[i].ExpiryDate=inp.value;}renderRows();}));
  $("itemsMetric").textContent=rows.length;$("qtyMetric").textContent=qty;$("costMetric").textContent=cost.toFixed(2);$("uniqueMetric").textContent=uniq.size;$("currentText").textContent=uniq.size;
}
window.removeRow=i=>{rows.splice(i,1);renderRows();};
window.clearRows=()=>{if(!submitted){rows=[];renderRows();}};
async function ensureMin(){await getMinQtyAsync();const n=Number($("currentText").textContent)||0,min=getMinQty();return n>=min;}
function payload(status){return {storeCode:currentStore.code,storeName:currentStore.name,classification:currentStore.classification,areaManager:currentStore.areaManager,operationManager:currentStore.operationManager,employeeId:currentEmployee.employeeId,employeeName:currentEmployee.employeeName,category:currentCategory,cycleStart:currentCycle?.start||"",cycleEnd:currentCycle?.end||"",status,items:rows,submittedAt:new Date().toISOString()};}
window.saveDraft=async()=>{
  if(!currentCategory||!rows.length){toast("Select a category and add items first.","error");return;}
  await set(ref(db,`expiryDrafts/${key(currentStore.code)}/${key(currentCategory)}`),payload("DRAFT"));toast("Draft saved to Firebase.","info");
};
window.submitFinal=async()=>{
  if(submitted){toast("Already submitted.","error");return;}
  if(!rows.length){toast("Add items first.","error");return;}
  if(!await ensureMin()){toast(`Minimum required: ${getMinQty()}. Current: ${$("currentText").textContent}.`,"error");return;}
  if(rows.some(x=>Number(x.Qty)>0&&!validDate(x.ExpiryDate))){toast("Every entered item with quantity must have a valid DD/MM/YYYY expiry date.","error");return;}
  const path=`storeSubmissions/${key(currentStore.code)}/${key(currentCategory)}`;
  const r=await runTransaction(ref(db,path),v=>v===null?payload("SUBMITTED"):v);
  if(!r.committed){submitted=true;updateSubmit();toast("This category was already submitted.","error");return;}
  await remove(ref(db,`expiryDrafts/${key(currentStore.code)}/${key(currentCategory)}`));
  submitted=true;updateSubmit();toast("Final submission saved to Firebase.","info");
};
function updateSubmit(){$("submitButton").disabled=submitted;$("submissionBadge").textContent=submitted?"Submitted":"Not submitted";$("submissionBadge").className="badge "+(submitted?"submitted":"");}

window.openAdminLogin=async()=>{
  const email=prompt("Admin email:",ADMIN_EMAIL);if(email===null)return;const pass=prompt("Admin password:");if(pass===null)return;
  try{
    const c=await signInWithEmailAndPassword(auth,email.trim(),pass);
    const flag=await read("admins/"+c.user.uid);
    if(norm(email)!==norm(ADMIN_EMAIL)&&flag!==true){await signOut(auth);throw new Error("Not an authorized admin.");}
    if(norm(email)===norm(ADMIN_EMAIL))await set(ref(db,"admins/"+c.user.uid),true);
    adminUser=c.user;hideAll();$("adminPage").classList.remove("hidden");await refreshAdmin();toast("Admin authenticated.","info");
  }catch(e){alert("Admin login failed: "+e.message);try{await signInAnonymously(auth);}catch(_){}}
};
window.adminLogout=async()=>{adminUser=null;await signOut(auth).catch(()=>{});await signInAnonymously(auth).catch(()=>{});goHome();};
function adminOnly(){if(!adminUser){alert("Admin login required.");return false;}return true;}
window.adminTab=t=>{document.querySelectorAll(".adminsec").forEach(x=>x.classList.remove("active"));$("admin-"+t).classList.add("active");if(t==="data")renderDataList();if(t==="stores")renderStores();if(t==="employees")renderEmployees();if(t==="categories")renderCategories();if(t==="assign")renderAssignments();if(t==="cycle")renderCycles();};

window.renderDataList=()=>{
  const q=norm($("adminSearch").value);const list=Object.values(products).filter(p=>[p.sku,p.barcode,p.description,p.category].some(x=>norm(x).includes(q))).slice(0,500);
  $("dataList").innerHTML=list.map(p=>`<div class="listrow"><div><b>${esc(p.sku)}</b> · ${esc(p.barcode)}<div class="small">${esc(p.description)} · ${esc(p.category)}</div></div><div><button class="ghost" onclick="editProduct('${esc(p.id)}')">Edit</button> <button class="danger" onclick="deleteProduct('${esc(p.id)}')">Delete</button></div></div>`).join("")||"<div class='listrow'>No items found.</div>";
};
window.editProduct=id=>{const p=products[id];if(!p)return;$("editId").value=id;$("fSku").value=p.sku;$("fBarcode").value=p.barcode;$("fUom").value=p.uom;$("fCost").value=p.cost;$("fCategory").value=p.category;$("fVendor").value=p.vendor;$("fDesc").value=p.description;$("fSupplier").value=p.supplier;$("fReturnable").value=p.returnable;};
window.clearProductForm=()=>{["editId","fSku","fBarcode","fUom","fCost","fCategory","fVendor","fDesc","fSupplier"].forEach(id=>$(id).value="");$("fUom").value="PCS";$("fReturnable").value="No";};
window.saveProduct=async()=>{
  if(!adminOnly())return;const id=clean($("editId").value)||key($("fSku").value);if(!id||!clean($("fSku").value)){alert("SKU required.");return;}
  const p={SKU:clean($("fSku").value),Barcodes:clean($("fBarcode").value),UOM:clean($("fUom").value)||"PCS","EN Desc":clean($("fDesc").value),Cost:Number($("fCost").value)||0,"Default Supplier":clean($("fSupplier").value),"Vendor Code":clean($("fVendor").value),Category:clean($("fCategory").value),"Non - Returnable & Returnable":clean($("fReturnable").value)||"No",Qty:0,"Total Cost":0,"Expiry Date":"","Days Left":""};
  await set(ref(db,"Data/items/"+id),p);await rebuildLookup();products=await loadProducts();renderDataList();clearProductForm();alert("Saved to Firebase.");
};
window.deleteProduct=async id=>{if(!adminOnly()||!confirm("Delete this item?"))return;await remove(ref(db,"Data/items/"+id));products=await loadProducts();await rebuildLookup();renderDataList();};
window.rebuildLookup=async()=>{
  if(!adminOnly())return;const bySku={},byBarcode={};
  for(const p of Object.values(products)){if(p.sku)bySku[key(p.sku).toLowerCase()]={...p};for(const b of String(p.barcode).split(/[,;|/]+/).map(clean).filter(Boolean))byBarcode[key(b).toLowerCase()]={...p};}
  await set(ref(db,"dataLookup/bySku"),bySku);await set(ref(db,"dataLookup/byBarcode"),byBarcode);$("adminStatus").textContent=`Lookup rebuilt: ${Object.keys(bySku).length} SKUs / ${Object.keys(byBarcode).length} barcodes.`;
};

window.saveStore=async()=>{if(!adminOnly())return;const c=clean($("sCode").value);if(!c)return;await set(ref(db,"storeMaster/"+key(c)),{code:c,name:clean($("sName").value),classification:clean($("sClass").value)||"C",areaManager:clean($("sAM").value),operationManager:clean($("sOM").value),region:clean($("sRegion").value)});stores=await read("storeMaster")||{};renderStores();alert("Store saved.");};
function renderStores(){$("storesList").innerHTML=Object.entries(stores).map(([id,v])=>{const s=normalizeStore(id,v);return `<div class="listrow"><div><b>${esc(s.code)}</b> · ${esc(s.name)}<div class="small">${esc(s.areaManager)} · ${esc(s.operationManager)}</div></div><button class="ghost" onclick="loadStore('${esc(id)}')">Edit</button></div>`}).join("");}
window.loadStore=id=>{const s=normalizeStore(id,stores[id]);$("sCode").value=s.code;$("sName").value=s.name;$("sClass").value=s.classification;$("sAM").value=s.areaManager;$("sOM").value=s.operationManager;$("sRegion").value=s.region;};

window.saveEmployee=async()=>{if(!adminOnly())return;const id=clean($("eId").value);if(!id)return;await set(ref(db,"EmpData/items/"+key(id)),{employeeId:id,employeeName:clean($("eName").value),storeCode:clean($("eStore").value),status:clean($("eStatus").value)||"Active",designation:clean($("eDesignation").value)});employees=normalizeEmployees(await read("EmpData")||{});renderEmployees();alert("Employee saved.");};
function renderEmployees(){$("employeesList").innerHTML=Object.values(employees).slice(0,1000).map(e=>`<div class="listrow"><div><b>${esc(e.employeeId)}</b> · ${esc(e.employeeName)}<div class="small">${esc(e.storeCode)} · ${esc(e.status)} · ${esc(e.designation)}</div></div></div>`).join("");}

window.addCategory=async()=>{if(!adminOnly())return;const n=clean($("newCategory").value);if(!n)return;await set(ref(db,"categories/"+key(n)),{name:n,active:true});categories=await read("categories")||{};$("newCategory").value="";renderCategories();};
function renderCategories(){$("categoriesList").innerHTML=Object.entries(categories).map(([id,v])=>`<div class="listrow"><b>${esc(v.name||v.category||id)}</b><span class="small">${esc(id)}</span></div>`).join("");}

window.assignCategory=async()=>{if(!adminOnly())return;const s=clean($("assignStore").value),c=clean($("assignCategory").value);if(!s||!c)return;await set(ref(db,`storeCategories/${key(s)}/${key(c)}`),true);storeCategories=await read("storeCategories")||{};renderAssignments();};
function renderAssignments(){$("assignList").innerHTML=Object.entries(storeCategories).map(([s,a])=>`<div class="listrow"><div><b>${esc(s)}</b><div class="small">${Object.keys(a||{}).join(", ")}</div></div></div>`).join("");}

window.saveCycle=async()=>{if(!adminOnly())return;const id=clean($("cycleId").value)||("cycle_"+Date.now());await set(ref(db,"categoryCycle/"+key(id)),{category:clean($("cycleCategory").value),start:$("cycleStart").value,end:$("cycleEnd").value});cycles=await read("categoryCycle")||{};renderCycles();};
function renderCycles(){$("cycleList").innerHTML=Object.entries(cycles).map(([id,v])=>`<div class="listrow"><div><b>${esc(v.category)}</b><div class="small">${esc(v.start)} → ${esc(v.end)}</div></div></div>`).join("");}

async function refreshAdmin(){stores=await read("storeMaster")||{};employees=normalizeEmployees(await read("EmpData")||{});categories=await read("categories")||{};storeCategories=await read("storeCategories")||{};cycles=await read("categoryCycle")||{};products=await loadProducts();await getMinQtyAsync();renderDataList();}

window.addEventListener("beforeunload",()=>{});


const state = { products: [], bundles: [], cart: [], activeTab: 'PRODUCT', search: '', slipFile: null, loading: false, scanner: { stream: null, detector: null, active: false, rafId: null } };
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

function init(){
  bindEvents();
  checkConfig();
  refreshInitialData();
  setInterval(()=>{ if(!state.loading) refreshInitialData(false); }, 45000);
}

function bindEvents(){
  $('refreshBtn').addEventListener('click',()=>refreshInitialData(true));
  $('hardReloadBtn').addEventListener('click',()=>{ location.href = location.pathname + '?v=' + Date.now(); });
  if($('dailySummaryBtn')) $('dailySummaryBtn').addEventListener('click',copyDailyMissionSummary);
  if($('quickOrderBtn')) $('quickOrderBtn').addEventListener('click',()=>{ $('searchInput').focus(); scrollToElement('catalogPanel'); });
  if($('mobileCartJumpBtn')) $('mobileCartJumpBtn').addEventListener('click',()=>scrollToElement('cartPanel'));
  $('searchInput').addEventListener('input',handleSearchInput);
  $('searchInput').addEventListener('keydown',handleSearchKeydown);
  $('scanBtn').addEventListener('click',openScanner);
  $('closeScannerBtn').addEventListener('click',closeScanner);
  document.querySelectorAll('.catalogTab').forEach(btn=>btn.addEventListener('click',()=>{ state.activeTab=btn.dataset.tab; renderTabs(); renderCatalog(); }));
  $('clearCartBtn').addEventListener('click',clearCart);
  ['customerShippingPaid','actualShippingCost','packagingCost','customerName','customerPhone','customerAddress','notes'].forEach(id=>$(id).addEventListener('input',renderSummaryAndValidate));
  $('copySummaryBtn').addEventListener('click',copyOrderSummary);
  $('slipFile').addEventListener('change',handleSlipChange);
  $('removeSlipBtn').addEventListener('click',removeSlip);
  $('submitBtn').addEventListener('click',handleSubmit);
  $('closeSuccessBtn').addEventListener('click',closeSuccessModal);
  $('copyOrderIdBtn').addEventListener('click',copyOrderId);
}

function checkConfig(){
  const cfg = window.KAPI_CONFIG || {};
  if($('versionText')) $('versionText').textContent = cfg.APP_VERSION || '3.2.0';
  if(!cfg.GAS_API_URL || cfg.GAS_API_URL.includes('PUT_YOUR') || !cfg.API_PUBLIC_TOKEN || cfg.API_PUBLIC_TOKEN.includes('PUT_YOUR')){
    $('configWarning').classList.remove('hidden');
    $('configWarning').textContent = 'ยังไม่ได้ตั้งค่า config.js: กรุณาใส่ GAS_API_URL และ API_PUBLIC_TOKEN ก่อนใช้งานจริง';
  }
}

async function api(action,payload={}){
  const cfg = window.KAPI_CONFIG || {};
  if(!cfg.GAS_API_URL || cfg.GAS_API_URL.includes('PUT_YOUR')) throw new Error('ยังไม่ได้ตั้งค่า GAS_API_URL ใน config.js');
  const body = { action, payload, token: cfg.API_PUBLIC_TOKEN, client: 'github-pages', version: cfg.APP_VERSION || '3.2.0' };
  const res = await fetch(cfg.GAS_API_URL, { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect:'follow' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch(e){ throw new Error('API ตอบกลับไม่ใช่ JSON: ' + text.slice(0,180)); }
  if(!data.success) throw new Error(data.message || 'API error');
  return data;
}

async function refreshInitialData(showToast=false){
  try{
    $('catalogLoading').classList.remove('hidden');
    const result = await api('getInitialData', showToast ? { forceRefresh: true } : {});
    state.products = Array.isArray(result.products)?result.products:[];
    state.bundles = Array.isArray(result.bundles)?result.bundles:[];
    $('paymentMethodText').textContent = result.paymentMethod || 'Bank Transfer';
    const syncLabel = result.cacheHit ? 'Cache' : 'Live';
    $('lastSyncText').textContent = syncLabel + ' · ' + new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    if($('syncBadge')) $('syncBadge').textContent = syncLabel;
    syncCartWithLatestCatalog(); renderTabs(); renderCatalog(); renderCart(); renderSummaryAndValidate(); updateMissionDashboard();
    if(showToast) showAlert('success','รีเฟรชข้อมูลสินค้าและสต็อกแล้ว');
  } catch(error){
    showAlert('error', normalizeError(error) + ' — หากเพิ่ง Deploy Apps Script ให้ตรวจว่าใช้ URL /exec และตั้งค่า Anyone แล้ว');
  } finally { $('catalogLoading').classList.add('hidden'); }
}

function syncCartWithLatestCatalog(){ state.cart = state.cart.map(item=>{ if(item.lineType==='PRODUCT'){ const p=state.products.find(x=>x.productId===item.referenceId); return p?{...item,displayName:p.productName,normalPrice:Number(p.normalPrice)||item.normalPrice,availableQty:Number(p.availableQty)||0}:item; } if(item.lineType==='BUNDLE'){ const b=state.bundles.find(x=>x.bundleId===item.referenceId); return b?{...item,displayName:b.bundleName,normalPrice:Number(b.normalPrice)||item.normalPrice,availableQty:Number(b.availableQty)||0,components:b.components||[]}:item; } return item; }); }
function renderTabs(){ document.querySelectorAll('.catalogTab').forEach(btn=>{ const active=btn.dataset.tab===state.activeTab; btn.classList.toggle('tab-active',active); btn.classList.toggle('tab-inactive',!active); }); }
function renderCatalog(){ const container=$('catalogList'); const search=state.search.toLowerCase(); if(state.activeTab==='PRODUCT'){ const list=state.products.filter(p=>[p.productId,p.productName,p.sku,p.barcodeValue,p.qrValue,p.shortSellingPoint,p.recommendedMenus].join(' ').toLowerCase().includes(search)); container.innerHTML = list.length?list.map(renderProductCard).join(''):emptyCatalogHtml('ไม่พบสินค้า'); bindCatalogButtons(); return; } const bundles=state.bundles.filter(b=>[b.bundleId,b.bundleName,b.description,b.bestForCustomer,b.sellingText].join(' ').toLowerCase().includes(search)); container.innerHTML = bundles.length?bundles.map(renderBundleCard).join(''):emptyCatalogHtml('ไม่พบโปรแพคคู่'); bindCatalogButtons(); }

function renderProductCard(p){ const qty=Number(p.availableQty)||0; const disabled=qty<=0; const statusClass=qty>10?'bg-emerald-100 text-emerald-800':qty>0?'bg-amber-100 text-amber-800':'bg-red-100 text-red-700'; const statusText=qty>10?'พร้อมขาย':qty>0?'ใกล้หมด':'หมด'; return `<article class="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="truncate text-base font-extrabold text-slate-950">${escapeHtml(p.productName)}</p><p class="mt-1 text-xs text-slate-500">SKU: ${escapeHtml(p.sku||p.productId)}</p></div><span class="shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${statusClass}">${statusText}</span></div><div class="mt-4 grid grid-cols-2 gap-3"><div class="rounded-2xl bg-slate-50 p-3"><p class="text-xs font-bold text-slate-500">ราคาปกติ</p><p class="text-xl font-extrabold text-slate-950">${formatMoney(p.normalPrice)}</p></div><div class="rounded-2xl bg-amber-50 p-3"><p class="text-xs font-bold text-amber-700">คงเหลือ</p><p class="text-xl font-extrabold text-amber-900">${formatNumber(qty)}</p></div></div><p class="mt-3 text-sm leading-6 text-slate-600">${escapeHtml(p.shortSellingPoint||'')}</p><details class="mt-3 rounded-2xl bg-slate-50 p-3"><summary class="cursor-pointer text-sm font-extrabold text-slate-700">ดูจุดขาย / ข้อความตอบลูกค้า</summary><div class="mt-3 space-y-2 text-sm leading-6 text-slate-600"><p><b>เหมาะกับ:</b> ${escapeHtml(p.bestForCustomer||'-')}</p><p><b>เมนู:</b> ${escapeHtml(p.recommendedMenus||'-')}</p><p><b>ฮาลาล:</b> ${p.hasHalal?'มีฮาลาล ✅':'-'}</p><button type="button" data-copy-selling="${escapeAttribute(p.sellingText||'')}" class="copySellingBtn mt-2 rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-amber-800 shadow-sm">คัดลอกข้อความขาย</button></div></details><button type="button" data-add-type="PRODUCT" data-add-id="${escapeAttribute(p.productId)}" class="addItemBtn mt-4 w-full rounded-2xl px-4 py-3 text-sm font-extrabold transition ${disabled?'bg-slate-100 text-slate-400 cursor-not-allowed':'bg-slate-950 text-white hover:bg-slate-800'}" ${disabled?'disabled':''}>เพิ่มลงตะกร้า</button></article>`; }
function renderBundleCard(b){ const qty=Number(b.availableQty)||0; const disabled=qty<=0; const comps=(b.components||[]).map(c=>`<li>${escapeHtml(c.productName)} x ${formatNumber(c.quantity)}</li>`).join(''); return `<article class="rounded-3xl border border-amber-100 bg-white p-4 shadow-sm"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="truncate text-base font-extrabold text-slate-950">${escapeHtml(b.bundleName)}</p><p class="mt-1 text-xs text-slate-500">${escapeHtml(b.description||'')}</p></div><span class="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-800">โปร</span></div><div class="mt-4 grid grid-cols-3 gap-2"><div class="rounded-2xl bg-slate-50 p-3"><p class="text-xs font-bold text-slate-500">ปกติ</p><p class="text-base font-extrabold text-slate-500 line-through">${formatMoney(b.normalPrice)}</p></div><div class="rounded-2xl bg-amber-50 p-3"><p class="text-xs font-bold text-amber-700">โปร</p><p class="text-xl font-extrabold text-amber-900">${formatMoney(b.bundlePrice)}</p></div><div class="rounded-2xl bg-emerald-50 p-3"><p class="text-xs font-bold text-emerald-700">ขายได้</p><p class="text-xl font-extrabold text-emerald-900">${formatNumber(qty)}</p></div></div><div class="mt-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600"><p class="font-extrabold text-slate-800">สินค้าในชุด</p><ul class="mt-1 list-inside list-disc">${comps}</ul></div><details class="mt-3 rounded-2xl bg-amber-50 p-3"><summary class="cursor-pointer text-sm font-extrabold text-amber-900">ดูจุดขาย / ข้อความตอบลูกค้า</summary><div class="mt-3 space-y-2 text-sm leading-6 text-amber-900"><p><b>เหมาะกับ:</b> ${escapeHtml(b.bestForCustomer||'-')}</p><button type="button" data-copy-selling="${escapeAttribute(b.sellingText||'')}" class="copySellingBtn mt-2 rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-amber-800 shadow-sm">คัดลอกข้อความขาย</button></div></details><button type="button" data-add-type="BUNDLE" data-add-id="${escapeAttribute(b.bundleId)}" class="addItemBtn mt-4 w-full rounded-2xl px-4 py-3 text-sm font-extrabold transition ${disabled?'bg-slate-100 text-slate-400 cursor-not-allowed':'bg-amber-600 text-white hover:bg-amber-700'}" ${disabled?'disabled':''}>เพิ่มโปรลงตะกร้า</button></article>`; }
function emptyCatalogHtml(message){return `<div class="sm:col-span-2 rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">${escapeHtml(message)}</div>`;}
function bindCatalogButtons(){ document.querySelectorAll('.addItemBtn').forEach(btn=>btn.addEventListener('click',()=>addToCart(btn.dataset.addType,btn.dataset.addId))); document.querySelectorAll('.copySellingBtn').forEach(btn=>btn.addEventListener('click',()=>{ copyText(btn.dataset.copySelling||''); showAlert('success','คัดลอกข้อความขายแล้ว'); })); }
function addToCart(lineType,referenceId){ if(lineType==='PRODUCT'){ const p=state.products.find(x=>x.productId===referenceId); if(!p) return showAlert('error','ไม่พบสินค้า'); if(Number(p.availableQty)<=0) return showAlert('error','สินค้านี้หมดสต็อก'); const e=state.cart.find(i=>i.lineType==='PRODUCT'&&i.referenceId===referenceId); if(e)e.quantity+=1; else state.cart.push({clientId:createClientId(),lineType:'PRODUCT',referenceId:p.productId,displayName:p.productName,quantity:1,unitPrice:Number(p.normalPrice)||0,normalPrice:Number(p.normalPrice)||0,availableQty:Number(p.availableQty)||0}); } if(lineType==='BUNDLE'){ const b=state.bundles.find(x=>x.bundleId===referenceId); if(!b) return showAlert('error','ไม่พบโปรแพคคู่'); if(Number(b.availableQty)<=0) return showAlert('error','โปรนี้มีสินค้าไม่พอ'); const e=state.cart.find(i=>i.lineType==='BUNDLE'&&i.referenceId===referenceId); if(e)e.quantity+=1; else state.cart.push({clientId:createClientId(),lineType:'BUNDLE',referenceId:b.bundleId,displayName:b.bundleName,quantity:1,unitPrice:Number(b.bundlePrice)||0,normalPrice:Number(b.normalPrice)||0,availableQty:Number(b.availableQty)||0,components:b.components||[]}); } showAlert('success','เพิ่มเข้าตะกร้าแล้ว'); renderCart(); renderSummaryAndValidate(); }
function renderCart(){ $('cartEmpty').classList.toggle('hidden',state.cart.length>0); const c=$('cartList'); if(!state.cart.length){ c.innerHTML=''; return; } c.innerHTML=state.cart.map(item=>{ const badge=item.lineType==='BUNDLE'?'<span class="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-extrabold text-amber-800">โปรแพคคู่</span>':'<span class="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-700">สินค้าเดี่ยว</span>'; return `<div class="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm"><div class="mb-3 flex items-start justify-between gap-3"><div class="min-w-0"><div class="mb-1">${badge}</div><p class="truncate font-extrabold text-slate-950">${escapeHtml(item.displayName)}</p><p class="mt-1 text-xs text-slate-500">${escapeHtml(item.referenceId)}</p></div><button type="button" data-remove-id="${escapeAttribute(item.clientId)}" class="removeCartBtn rounded-xl bg-red-50 px-3 py-2 text-xs font-extrabold text-red-600">ลบ</button></div><div class="grid grid-cols-2 gap-3"><div><label class="label">จำนวน</label><input data-qty-id="${escapeAttribute(item.clientId)}" class="cartQtyInput input" type="number" min="1" step="1" value="${Number(item.quantity)||1}"></div><div><label class="label">ราคาขาย/รายการ</label><input data-price-id="${escapeAttribute(item.clientId)}" class="cartPriceInput input" type="number" min="0" step="0.01" value="${Number(item.unitPrice)||0}"></div></div><div class="mt-3 flex items-center justify-between rounded-2xl bg-slate-50 p-3"><span class="text-sm font-bold text-slate-500">รวมรายการนี้</span><span class="text-lg font-extrabold text-slate-950">${formatMoney((Number(item.quantity)||0)*(Number(item.unitPrice)||0))}</span></div></div>`; }).join(''); document.querySelectorAll('.removeCartBtn').forEach(btn=>btn.addEventListener('click',()=>{state.cart=state.cart.filter(i=>i.clientId!==btn.dataset.removeId);renderCart();renderSummaryAndValidate();})); document.querySelectorAll('.cartQtyInput').forEach(input=>input.addEventListener('input',()=>{ const item=state.cart.find(x=>x.clientId===input.dataset.qtyId); if(item)item.quantity=Math.max(1,parseInt(input.value||'1',10)); renderSummaryAndValidate(); })); document.querySelectorAll('.cartPriceInput').forEach(input=>input.addEventListener('input',()=>{ const item=state.cart.find(x=>x.clientId===input.dataset.priceId); if(item)item.unitPrice=Math.max(0,Number(input.value||0)); renderSummaryAndValidate(); })); }
function clearCart(){state.cart=[];renderCart();renderSummaryAndValidate();}
function renderSummaryAndValidate(){ const subtotal=calculateSubtotal(); const ship=Number($('customerShippingPaid').value||0); $('summarySubtotal').textContent=`${formatMoney(subtotal)} บาท`; $('summaryGrandTotal').textContent=formatMoney(subtotal+ship); const warnings=validateCartStock(); if(warnings.length){ $('cartWarnings').classList.remove('hidden'); $('cartWarnings').innerHTML=warnings.map(w=>`<p>• ${escapeHtml(w)}</p>`).join(''); } else { $('cartWarnings').classList.add('hidden'); $('cartWarnings').innerHTML=''; } validateForm(warnings); updateMissionDashboard(); }
function calculateSubtotal(){return round2(state.cart.reduce((t,i)=>t+((Number(i.quantity)||0)*(Number(i.unitPrice)||0)),0));}
function validateCartStock(){ const needs={}; state.cart.forEach(item=>{ if(item.lineType==='PRODUCT') needs[item.referenceId]=(needs[item.referenceId]||0)+(Number(item.quantity)||0); if(item.lineType==='BUNDLE'){ const b=state.bundles.find(x=>x.bundleId===item.referenceId); const comps=b?b.components||[]:item.components||[]; comps.forEach(c=>needs[c.productId]=(needs[c.productId]||0)+((Number(c.quantity)||0)*(Number(item.quantity)||0))); } }); const warnings=[]; Object.keys(needs).forEach(id=>{ const p=state.products.find(x=>x.productId===id); const available=p?Number(p.availableQty)||0:0; if(needs[id]>available) warnings.push(`${p?p.productName:id} ต้องใช้ ${needs[id]} ชิ้น แต่คงเหลือ ${available} ชิ้น`); }); return warnings; }
function validateForm(stockWarnings){ const warnings=stockWarnings||validateCartStock(); const ok=state.cart.length>0 && warnings.length===0 && $('customerName').value.trim() && $('customerPhone').value.trim() && $('customerAddress').value.trim() && isNonNegativeNumber($('customerShippingPaid').value) && isNonNegativeNumber($('actualShippingCost').value) && isNonNegativeNumber($('packagingCost').value) && !!state.slipFile && !state.loading; $('submitBtn').disabled=!ok; $('submitHint').textContent = !state.cart.length?'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ':warnings.length?'มีรายการสินค้าเกินสต็อก':(!$('customerName').value.trim()||!$('customerPhone').value.trim()||!$('customerAddress').value.trim())?'กรุณากรอกข้อมูลลูกค้าให้ครบ':!state.slipFile?'กรุณาแนบสลิปโอนเงิน':ok?'พร้อมบันทึกออเดอร์':'กรุณาตรวจสอบข้อมูล'; return !!ok; }
function handleSearchInput(e){state.search=e.target.value.trim();renderCatalog();}
function handleSearchKeydown(e){ if(e.key!=='Enter')return; e.preventDefault(); const code=$('searchInput').value.trim(); if(!code)return; const p=findProductByAnyCode(code); if(p){addToCart('PRODUCT',p.productId);$('searchInput').value='';state.search='';renderCatalog();} else showAlert('error','ไม่พบสินค้าที่ตรงกับรหัสนี้'); }
function findProductByAnyCode(code){ const input=normalizeProductCode(code).toLowerCase(); return state.products.find(p=>[p.productId,p.sku,p.barcodeValue,p.qrValue,normalizeProductCode(p.qrValue||'')].map(v=>String(v||'').trim().toLowerCase()).includes(input)||String(code||'').trim().toLowerCase()===String(p.qrValue||'').trim().toLowerCase())||null; }
function normalizeProductCode(v){const t=String(v||'').trim();return t.toUpperCase().startsWith('PRODUCT:')?t.substring('PRODUCT:'.length).trim():t;}
async function openScanner(){ $('scannerModal').classList.remove('hidden'); $('scannerModal').classList.add('flex'); try{ if(!('BarcodeDetector' in window)){ $('scannerStatus').textContent='อุปกรณ์นี้ยังไม่รองรับ BarcodeDetector กรุณาใช้ช่องพิมพ์ SKU หรือยิงบาร์โค้ดแทน'; return; } state.scanner.detector=new BarcodeDetector({formats:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e']}); state.scanner.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}); const video=$('scannerVideo'); video.srcObject=state.scanner.stream; await video.play(); state.scanner.active=true; $('scannerStatus').textContent='กำลังสแกน...'; scanLoop(); }catch(error){$('scannerStatus').textContent='เปิดกล้องไม่สำเร็จ: '+normalizeError(error);} }
async function scanLoop(){ if(!state.scanner.active||!state.scanner.detector)return; try{ const video=$('scannerVideo'); if(video.readyState>=2){ const codes=await state.scanner.detector.detect(video); if(codes&&codes.length){ const value=codes[0].rawValue||''; if(value){ handleScannedCode(value); return; } } } }catch(e){} state.scanner.rafId=requestAnimationFrame(scanLoop); }
function handleScannedCode(value){ closeScanner(); const p=findProductByAnyCode(value); if(!p){ $('searchInput').value=value; state.search=value; renderCatalog(); showAlert('error','สแกนได้ "'+value+'" แต่ยังไม่พบสินค้าในระบบ'); return; } addToCart('PRODUCT',p.productId); showAlert('success','สแกนสำเร็จและเพิ่มสินค้าเข้าตะกร้าแล้ว'); }
function closeScanner(){ state.scanner.active=false; if(state.scanner.rafId)cancelAnimationFrame(state.scanner.rafId); if(state.scanner.stream)state.scanner.stream.getTracks().forEach(t=>t.stop()); state.scanner.stream=null; const video=$('scannerVideo'); video.pause(); video.srcObject=null; $('scannerModal').classList.add('hidden'); $('scannerModal').classList.remove('flex'); }
async function handleSlipChange(e){ const file=e.target.files&&e.target.files[0]; if(!file){removeSlip();return;} if(!file.type.startsWith('image/')){showAlert('error','กรุณาอัปโหลดไฟล์รูปภาพเท่านั้น');removeSlip();return;} try{ setLoading(true,'กำลังเตรียมรูปสลิป...'); const compressed=await compressImageToBase64(file,{maxWidth:1600,maxHeight:1600,quality:.86}); state.slipFile={base64:compressed.base64,mimeType:'image/jpeg',fileName:file.name.replace(/\.[^/.]+$/,'')+'.jpg'}; $('slipPreview').src=compressed.base64; $('slipFileName').textContent=`${file.name} · ย่อรูปแล้ว`; $('slipPreviewBox').classList.remove('hidden'); showAlert('success','แนบสลิปเรียบร้อย'); }catch(error){showAlert('error',normalizeError(error));removeSlip();} finally{setLoading(false);renderSummaryAndValidate();} }
function removeSlip(){ state.slipFile=null; $('slipFile').value=''; $('slipPreview').removeAttribute('src'); $('slipFileName').textContent=''; $('slipPreviewBox').classList.add('hidden'); renderSummaryAndValidate(); }
async function compressImageToBase64(file,opt){ const dataUrl=await readFileAsDataURL(file); const img=await loadImage(dataUrl); const ratio=Math.min((opt.maxWidth||1600)/img.width,(opt.maxHeight||1600)/img.height,1); const w=Math.round(img.width*ratio),h=Math.round(img.height*ratio); const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h); return {base64:canvas.toDataURL('image/jpeg',opt.quality||.86),width:w,height:h}; }
function readFileAsDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('อ่านไฟล์ไม่สำเร็จ'));r.readAsDataURL(file);});}
function loadImage(src){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=()=>rej(new Error('โหลดรูปภาพไม่สำเร็จ'));img.src=src;});}
async function handleSubmit(){ if(!validateForm())return; const payload={customerName:$('customerName').value.trim(),customerPhone:$('customerPhone').value.trim(),customerAddress:$('customerAddress').value.trim(),paymentMethod:'Bank Transfer',customerShippingPaid:Number($('customerShippingPaid').value||0),actualShippingCost:Number($('actualShippingCost').value||0),packagingCost:Number($('packagingCost').value||0),notes:$('notes').value.trim(),slipFile:state.slipFile,items:state.cart.map(i=>({lineType:i.lineType,referenceId:i.referenceId,quantity:Number(i.quantity)||1,unitPrice:Number(i.unitPrice)||0}))}; try{setLoading(true,'กำลังบันทึกออเดอร์...'); const result=await api('createOrder',payload); $('successOrderId').textContent=result.orderId||'-'; openSuccessModal(); resetFormAfterSubmit(); if(result.remainingData&&result.remainingData.success){state.products=result.remainingData.products||[];state.bundles=result.remainingData.bundles||[];renderCatalog();}else refreshInitialData(false); }catch(error){showAlert('error',normalizeError(error));}finally{setLoading(false);renderSummaryAndValidate();} }
function resetFormAfterSubmit(){state.cart=[];removeSlip();['customerName','customerPhone','customerAddress','notes'].forEach(id=>$(id).value='');$('customerShippingPaid').value='40';$('actualShippingCost').value='40';$('packagingCost').value='0';renderCart();renderSummaryAndValidate();}
function copyOrderSummary(){ const lines=['สรุปยอดโอนค่ะ']; state.cart.forEach(i=>{const qty=Number(i.quantity)||0,price=Number(i.unitPrice)||0;lines.push(`- ${i.displayName} x ${qty} = ${formatMoney(qty*price)} บาท`);}); const subtotal=calculateSubtotal(),ship=Number($('customerShippingPaid').value||0); lines.push(`ค่าส่ง ${formatMoney(ship)} บาท`); lines.push(`รวมโอน ${formatMoney(subtotal+ship)} บาท`); lines.push('ชำระผ่านโอนเงินเท่านั้น ไม่มี COD ค่ะ'); copyText(lines.join('\n')); showAlert('success','คัดลอกสรุปยอดแล้ว'); }
function copyOrderId(){copyText($('successOrderId').textContent.trim());showAlert('success','คัดลอก Order ID แล้ว');}
function openSuccessModal(){$('successModal').classList.remove('hidden');$('successModal').classList.add('flex');}
function closeSuccessModal(){$('successModal').classList.add('hidden');$('successModal').classList.remove('flex');}
function setLoading(isLoading,text){state.loading=isLoading;$('submitSpinner').classList.toggle('hidden',!isLoading);$('submitText').textContent=text||(isLoading?'กำลังทำรายการ...':'บันทึกออเดอร์');validateForm();}
function showAlert(type,message){ const box=$('alertBox'); const classes=type==='success'?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-red-200 bg-red-50 text-red-700'; box.className=`mb-5 rounded-2xl border px-4 py-3 text-sm fade-in ${classes}`; box.textContent=message; box.classList.remove('hidden'); clearTimeout(showAlert._timer); showAlert._timer=setTimeout(()=>box.classList.add('hidden'),type==='success'?3500:9000); }
function copyText(text){ if(!text)return; if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);return;} const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
function isNonNegativeNumber(v){const n=Number(v);return Number.isFinite(n)&&n>=0;}
function normalizeError(e){return !e?'เกิดข้อผิดพลาด':typeof e==='string'?e:e.message?e.message:JSON.stringify(e);}
function formatMoney(v){return new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(Number(v)||0);}
function formatNumber(v){return new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(Number(v)||0);}
function round2(v){return Math.round((Number(v)||0)*100)/100;}
function createClientId(){return 'CART-'+Date.now()+'-'+Math.random().toString(16).slice(2);}
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function escapeAttribute(v){return escapeHtml(v).replaceAll('`','&#096;');}


/* =========================
 * Cyber Prosperity Dashboard helpers
 * ========================= */
function updateMissionDashboard(){
  try{
    const subtotal = calculateSubtotal ? calculateSubtotal() : 0;
    const shipping = Number($('customerShippingPaid') ? $('customerShippingPaid').value || 0 : 0);
    const grand = subtotal + shipping;
    const cartQty = state.cart.reduce((sum,item)=>sum+(Number(item.quantity)||0),0);
    const productCount = state.products.length;
    const bundleCount = state.bundles.length;
    const stockRisk = state.products.filter(p => Number(p.availableQty || 0) > 0 && Number(p.availableQty || 0) <= 5).length;
    const stockReady = state.products.filter(p => Number(p.availableQty || 0) > 0).length;
    const target = Number((window.KAPI_CONFIG && window.KAPI_CONFIG.DAILY_TARGET) || 1000);
    const progress = Math.max(0, Math.min(100, target ? Math.round((grand / target) * 100) : 0));

    setText('dashCartItems', formatNumber(cartQty));
    setText('dashCartTotal', formatMoney(grand));
    setText('dashCatalogCount', formatNumber(productCount + bundleCount));
    setText('dashStockReady', formatNumber(stockReady));
    setText('dashStockRisk', formatNumber(stockRisk));
    setText('missionProgressText', progress + '%');
    setText('missionTargetText', formatMoney(target) + ' บาท');

    const bar = $('missionProgressBar');
    if(bar) bar.style.width = progress + '%';

    const risk = $('stockRiskBadge');
    if(risk){
      risk.textContent = stockRisk > 0 ? 'เฝ้าระวัง ' + stockRisk + ' รายการ' : 'สต็อกพร้อมขาย';
      risk.classList.toggle('is-danger', stockRisk > 0);
    }

    const cartBadge = $('floatingCartBadge');
    if(cartBadge) cartBadge.textContent = formatNumber(cartQty);
  }catch(e){
    console.warn('updateMissionDashboard failed', e);
  }
}

function copyDailyMissionSummary(){
  const subtotal = calculateSubtotal();
  const shipping = Number($('customerShippingPaid').value || 0);
  const grand = subtotal + shipping;
  const cartQty = state.cart.reduce((sum,item)=>sum+(Number(item.quantity)||0),0);
  const stockRisk = state.products.filter(p => Number(p.availableQty || 0) > 0 && Number(p.availableQty || 0) <= 5);
  const lines = [];

  lines.push('สรุปภารกิจขาย กะปิแม่แดง ระนอง');
  lines.push('เวลา: ' + new Date().toLocaleString('th-TH'));
  lines.push('');
  lines.push('รายการในตะกร้า: ' + formatNumber(cartQty) + ' ชิ้น');
  lines.push('ยอดออเดอร์ปัจจุบัน: ' + formatMoney(grand) + ' บาท');
  lines.push('สินค้า/โปรพร้อมเลือก: ' + formatNumber(state.products.length + state.bundles.length) + ' รายการ');
  lines.push('สต็อกเฝ้าระวัง: ' + formatNumber(stockRisk.length) + ' รายการ');

  if(state.cart.length){
    lines.push('');
    lines.push('รายละเอียดออเดอร์:');
    state.cart.forEach(item=>{
      const qty = Number(item.quantity)||0;
      const price = Number(item.unitPrice)||0;
      lines.push('- ' + item.displayName + ' x ' + qty + ' = ' + formatMoney(qty*price) + ' บาท');
    });
  }

  if(stockRisk.length){
    lines.push('');
    lines.push('สต็อกใกล้หมด:');
    stockRisk.slice(0,8).forEach(p=>lines.push('- ' + p.productName + ': ' + formatNumber(p.availableQty) + ' ชิ้น'));
  }

  copyText(lines.join('\n'));
  showAlert('success','คัดลอกสรุปภารกิจแล้ว');
}

function setText(id,value){
  const el = $(id);
  if(el) el.textContent = value;
}

function scrollToElement(id){
  const el = $(id);
  if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
}

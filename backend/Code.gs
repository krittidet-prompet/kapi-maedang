
/**
 * Kapi Maedang Ranong Deal Management System
 * Version 3.1.0 - GitHub Frontend Edition
 *
 * Architecture:
 * - Frontend: GitHub Pages static site
 * - Backend/API: Google Apps Script Web App
 * - Database: Google Sheets
 * - Slip storage: Google Drive
 *
 * Required Script Properties:
 * - API_PUBLIC_TOKEN : token sent by frontend; lightweight gate, not a true secret if frontend is public
 * - ADMIN_PIN        : PIN for admin-only functions
 * - SLIP_FOLDER_ID  : Google Drive folder ID for payment slips
 * Optional:
 * - SPREADSHEET_ID  : needed only if this script is not bound to the spreadsheet
 */

const APP = {
  APP_NAME: 'บริหารดีลสินค้า กะปิแม่แดง ระนอง',
  VERSION: '3.1.0',
  SPREADSHEET_ID: '',
  DRIVE_FOLDER_ID: 'PUT_YOUR_DRIVE_FOLDER_ID_HERE',
  ADMIN_PIN: 'CHANGE_ME_ADMIN_PIN',
  API_PUBLIC_TOKEN: 'CHANGE_ME_PUBLIC_TOKEN',
  MAKE_SLIPS_PUBLIC_WITH_LINK: false,
  DEFAULT_PAYMENT_METHOD: 'Bank Transfer',
  DEFAULT_CUSTOMER_SHIPPING: 40,
  DEFAULT_ACTUAL_SHIPPING: 40,
  DEFAULT_PACKAGING_COST: 0,
  YOUR_MARGIN_RATE: 0.10,
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  DEFAULT_TIMEZONE: 'Asia/Bangkok'
};

const SHEET_NAMES = {
  ORDERS: 'Orders',
  ORDER_ITEMS: 'OrderItems',
  SETTLEMENTS: 'Settlements',
  INVENTORY: 'Inventory',
  PRODUCTS: 'Products',
  BUNDLES: 'Bundles',
  BUNDLE_ITEMS: 'BundleItems',
  API_LOGS: 'ApiLogs'
};

const HEADERS = {
  [SHEET_NAMES.ORDERS]: [
    'OrderID','OrderDate','CustomerName','CustomerPhone','CustomerAddress','PaymentMethod','SlipImageURL',
    'CustomerShippingPaid','ActualShippingCost','PackagingCost','OrderSubtotal','OrderGrandTotal',
    'DealerCostTotal','LandedCostTotal','YourMarginTotal','SellerNetProfit','SettlementID','OrderStatus',
    'ExceptionStatus','Notes','CreatedAt','CreatedBy'
  ],
  [SHEET_NAMES.ORDER_ITEMS]: [
    'OrderItemID','OrderID','LineType','ReferenceID','DisplayName','ProductID','ProductName','Quantity',
    'UnitPrice','LineTotal','FIFOAllocationJSON','DealerCostTotal','LandedCostTotal','YourMarginTotal','CreatedAt'
  ],
  [SHEET_NAMES.SETTLEMENTS]: [
    'SettlementID','DateRange','PeriodStart','PeriodEnd','TotalDealerCost','TotalYourNetProfit','TotalLandedCost',
    'TotalSalesAmount','TotalSellerNetProfit','SellerTransferSlip','Status','OrderCount','CreatedAt','PaidAt','Notes'
  ],
  [SHEET_NAMES.INVENTORY]: [
    'ProductID','ProductName','LotNumber','DateReceived','InitialQty','RemainingQty','CompanyCost','InboundShipping',
    'LandedUnitCost','YourMarginUnit','DealerUnitCost','Status','LastUpdated','Notes'
  ],
  [SHEET_NAMES.PRODUCTS]: [
    'ProductID','ProductName','SKU','BarcodeValue','QRValue','Size','NormalPrice','ShortSellingPoint',
    'TasteProfile','BestForCustomer','RecommendedMenus','HasHalal','Unit','Active','SortOrder','Notes','CreatedAt'
  ],
  [SHEET_NAMES.BUNDLES]: [
    'BundleID','BundleName','BundlePrice','NormalPrice','ShippingFee','Description','BestForCustomer','SellingText',
    'Active','SortOrder','Notes','CreatedAt'
  ],
  [SHEET_NAMES.BUNDLE_ITEMS]: ['BundleID','ProductID','Quantity'],
  [SHEET_NAMES.API_LOGS]: ['Timestamp','Action','Success','Message','Client','Version']
};

/**
 * Health endpoint for browser/open test.
 * Deploy URL can be opened directly and should return JSON text.
 */
function doGet(e) {
  return jsonOutput_({
    success: true,
    appName: APP.APP_NAME,
    version: APP.VERSION,
    message: 'API is running. Use POST from GitHub Pages frontend.',
    now: new Date().toISOString()
  });
}

/**
 * API endpoint for GitHub Pages frontend.
 * IMPORTANT: Frontend sends Content-Type text/plain to avoid CORS preflight.
 */
function doPost(e) {
  let action = 'unknown';
  try {
    setupDatabase();
    const body = parseRequestBody_(e);
    action = normalizeText_(body.action || (body.payload && body.payload.action));

    if (!action) throw new Error('Missing action');

    if (action !== 'health') {
      assertApiToken_(body.token || body.apiToken || (body.payload && body.payload.token));
    }

    let result;
    switch (action) {
      case 'health':
        result = { success: true, appName: APP.APP_NAME, version: APP.VERSION, now: new Date().toISOString() };
        break;
      case 'getInitialData':
        result = getInitialData();
        break;
      case 'createOrder':
        result = createOrder(body.payload || {});
        break;
      case 'seedKapiCatalog':
        result = seedKapiCatalog(body.adminPin || (body.payload && body.payload.adminPin));
        break;
      case 'addInventoryLot':
        result = addInventoryLot(body.payload || {}, body.adminPin || (body.payload && body.payload.adminPin));
        break;
      case 'getPendingSettlementPreview':
        result = getPendingSettlementPreview(body.periodStart, body.periodEnd, body.adminPin);
        break;
      case 'createSettlementForDateRange':
        result = createSettlementForDateRange(body.periodStart, body.periodEnd, body.adminPin);
        break;
      case 'markSettlementPaid':
        result = markSettlementPaid(body.settlementId, body.transferSlipFile || null, body.adminPin);
        break;
      case 'setOrderException':
        result = setOrderException(body.payload || {}, body.adminPin || (body.payload && body.payload.adminPin));
        break;
      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }

    logApi_(action, !!result.success, result.message || 'OK', body.client || '', body.version || '');
    return jsonOutput_(result);
  } catch (err) {
    logApi_(action, false, err.message, '', '');
    return jsonOutput_({ success: false, message: err.message, stack: err.stack });
  }
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const raw = e.postData.contents;
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Fallback for form-encoded requests: payload=<json>
    if (e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
    throw new Error('Invalid JSON request body');
  }
}

function setupDatabase() {
  const ss = getSpreadsheet_();
  Object.keys(HEADERS).forEach(function (sheetName) {
    ensureSheetWithHeaders_(ss, sheetName, HEADERS[sheetName]);
  });
  return { success: true, message: 'Database ready', spreadsheetUrl: ss.getUrl() };
}

/**
 * Run this from Apps Script editor after setting ADMIN_PIN.
 */
function adminSeedKapiCatalogFromProperties() {
  return seedKapiCatalog(getAdminPin_());
}

/**
 * Optional sample lots. Replace costs with real costs before production use.
 */
function adminAddSampleLotsFromProperties() {
  const pin = getAdminPin_();
  const today = formatDate_(new Date(), 'yyyy-MM-dd');
  return [
    addInventoryLot({ productId: 'KAPI-MAEDANG-200', productName: 'กะปิแม่แดง 200 กรัม', lotNumber: 'LOT-MD200-001', dateReceived: today, initialQty: 50, companyCost: 45, inboundShipping: 5, notes: 'sample lot' }, pin),
    addInventoryLot({ productId: 'KAPI-MAEDANG-500', productName: 'กะปิแม่แดง 500 กรัม', lotNumber: 'LOT-MD500-001', dateReceived: today, initialQty: 50, companyCost: 85, inboundShipping: 5.28, notes: 'sample lot' }, pin),
    addInventoryLot({ productId: 'KAPI-TAWENG-500', productName: 'กะปิตาเว้ง 500 กรัม', lotNumber: 'LOT-TW500-001', dateReceived: today, initialQty: 50, companyCost: 55, inboundShipping: 5, notes: 'sample lot' }, pin),
    addInventoryLot({ productId: 'KAPI-KHADNAM-SMALL', productName: 'กะปิขัดน้ำ กระปุกเล็ก', lotNumber: 'LOT-KN-001', dateReceived: today, initialQty: 50, companyCost: 100, inboundShipping: 5, notes: 'sample lot' }, pin)
  ];
}

function getInitialData() {
  setupDatabase();
  const products = getPublicProducts_();
  return {
    success: true,
    appName: APP.APP_NAME,
    version: APP.VERSION,
    paymentMethod: APP.DEFAULT_PAYMENT_METHOD,
    defaultCustomerShipping: APP.DEFAULT_CUSTOMER_SHIPPING,
    defaultActualShipping: APP.DEFAULT_ACTUAL_SHIPPING,
    defaultPackagingCost: APP.DEFAULT_PACKAGING_COST,
    serverTime: new Date().toISOString(),
    products: products,
    bundles: getPublicBundles_(products)
  };
}

function seedKapiCatalog(adminPin) {
  assertAdmin_(adminPin);
  setupDatabase();

  const products = [
    { ProductID: 'KAPI-MAEDANG-200', ProductName: 'กะปิแม่แดง 200 กรัม', SKU: 'MD200', BarcodeValue: '', QRValue: 'PRODUCT:KAPI-MAEDANG-200', Size: '200 กรัม', NormalPrice: 80, ShortSellingPoint: 'กะปิจืด เค็มน้อย กุ้งเคยแท้ คัดด้วยมือ', TasteProfile: 'รสนุ่ม เค็มน้อย กินง่าย', BestForCustomer: 'คนชอบกะปิรสนุ่ม ไม่เค็มจัด กินง่าย ตัวขายดี', RecommendedMenus: 'น้ำพริกกะปิ, ส้มตำ, จิ้มสด, แกง, ผัด', HasHalal: true, Unit: 'กระปุก', Active: true, SortOrder: 10, Notes: 'มี อย. และฮาลาล' },
    { ProductID: 'KAPI-MAEDANG-500', ProductName: 'กะปิแม่แดง 500 กรัม', SKU: 'MD500', BarcodeValue: '', QRValue: 'PRODUCT:KAPI-MAEDANG-500', Size: '500 กรัม', NormalPrice: 140, ShortSellingPoint: 'กะปิจืด เค็มน้อย กุ้งเคยแท้ คัดด้วยมือ', TasteProfile: 'รสนุ่ม เค็มน้อย กินง่าย', BestForCustomer: 'คนชอบกะปิรสนุ่ม ไม่เค็มจัด กินง่าย ตัวขายดี', RecommendedMenus: 'น้ำพริกกะปิ, ส้มตำ, จิ้มสด, แกง, ผัด', HasHalal: true, Unit: 'กระปุก', Active: true, SortOrder: 20, Notes: 'มี อย. และฮาลาล' },
    { ProductID: 'KAPI-TAWENG-500', ProductName: 'กะปิตาเว้ง 500 กรัม', SKU: 'TW500', BarcodeValue: '', QRValue: 'PRODUCT:KAPI-TAWENG-500', Size: '500 กรัม', NormalPrice: 90, ShortSellingPoint: 'ราคาประหยัด ใช้คุ้ม รสชัดกว่า', TasteProfile: 'รสชัด เหมาะกับทำกับข้าวประจำวัน', BestForCustomer: 'คนที่ใช้กะปิบ่อย อยากได้ตัวคุ้มราคา', RecommendedMenus: 'แกงใต้, แกงกะทิ, แกงส้ม, ผัด, ต้ม', HasHalal: true, Unit: 'กระปุก', Active: true, SortOrder: 30, Notes: 'มีฮาลาล' },
    { ProductID: 'KAPI-KHADNAM-SMALL', ProductName: 'กะปิขัดน้ำ กระปุกเล็ก', SKU: 'KN-SMALL', BarcodeValue: '', QRValue: 'PRODUCT:KAPI-KHADNAM-SMALL', Size: 'กระปุกเล็ก', NormalPrice: 160, ShortSellingPoint: 'ตัวพรีเมียม เนื้อเนียน สีสวย หอม เค็มน้อย รสนัวลึก', TasteProfile: 'หอม เนียน นัว เค็มน้อย', BestForCustomer: 'คนที่อยากได้กะปิคุณภาพดี กลิ่นหอม เนื้อสวย', RecommendedMenus: 'ข้าวคลุกกะปิ, ข้าวผัดกะปิ, น้ำพริก, แกงส้ม, แกงเลียง', HasHalal: true, Unit: 'กระปุก', Active: true, SortOrder: 40, Notes: 'มีฮาลาล' }
  ];

  const bundles = [
    { BundleID: 'BUNDLE-RANONG-TRY', BundleName: 'ชุดลองของดีระนอง', BundlePrice: 165, NormalPrice: 170, ShippingFee: 40, Description: 'แม่แดง 200g + ตาเว้ง 500g', BestForCustomer: 'ลูกค้าที่อยากลอง 2 แบบ', SellingText: 'แนะนำชุดลองของดีระนองค่ะ ได้กะปิแม่แดง 200 กรัม + กะปิตาเว้ง 500 กรัม จากปกติ 170 บาท เหลือ 165 บาท ค่าส่ง 40 บาทเท่าเดิม คุ้มกว่าซื้อแยก เหมาะกับลูกค้าที่อยากลอง 2 แบบค่ะ', Active: true, SortOrder: 10, Notes: 'โปรหลักแนะนำให้ดันก่อน' },
    { BundleID: 'BUNDLE-NAMPRIK-GAENGTAI', BundleName: 'ชุดน้ำพริก-แกงใต้', BundlePrice: 225, NormalPrice: 230, ShippingFee: 40, Description: 'แม่แดง 500g + ตาเว้ง 500g', BestForCustomer: 'บ้านที่ทำทั้งน้ำพริกและแกง', SellingText: 'แนะนำชุดน้ำพริก-แกงใต้ค่ะ ได้กะปิแม่แดง 500 กรัม + กะปิตาเว้ง 500 กรัม จากปกติ 230 บาท เหลือ 225 บาท ใช้ได้ทั้งทำน้ำพริกและแกงใต้ ค่าส่ง 40 บาทเท่าเดิมค่ะ', Active: true, SortOrder: 20, Notes: 'โปรหลักแนะนำให้ดันก่อน' },
    { BundleID: 'BUNDLE-PREMIUM-AROMA', BundleName: 'ชุดหอมพรีเมียม', BundlePrice: 295, NormalPrice: 300, ShippingFee: 40, Description: 'แม่แดง 500g + ขัดน้ำ', BestForCustomer: 'ลูกค้าที่อยากได้ตัวขายดี + ตัวพรีเมียม', SellingText: 'แนะนำชุดหอมพรีเมียมค่ะ ได้กะปิแม่แดง 500 กรัม + กะปิขัดน้ำ ตัวขายดีคู่กับตัวพรีเมียม หอม เนียน นัว เหมาะกับทั้งน้ำพริกและเมนูที่อยากได้กลิ่นหอมพิเศษค่ะ', Active: true, SortOrder: 30, Notes: '' },
    { BundleID: 'BUNDLE-NAMPRIK-NUA', BundleName: 'ชุดตำน้ำพริกนัว ๆ', BundlePrice: 235, NormalPrice: 240, ShippingFee: 40, Description: 'แม่แดง 200g + ขัดน้ำ', BestForCustomer: 'คนเน้นตำน้ำพริก/จิ้มสด', SellingText: 'แนะนำชุดตำน้ำพริกนัว ๆ ค่ะ ได้กะปิแม่แดง 200 กรัม + กะปิขัดน้ำ เหมาะกับลูกค้าที่เน้นน้ำพริก จิ้มสด หรืออยากได้กลิ่นหอมพิเศษค่ะ', Active: true, SortOrder: 40, Notes: '' },
    { BundleID: 'BUNDLE-SOUTHERN-KITCHEN', BundleName: 'ชุดครัวใต้ครบเครื่อง', BundlePrice: 245, NormalPrice: 250, ShippingFee: 40, Description: 'ตาเว้ง 500g + ขัดน้ำ', BestForCustomer: 'ทำแกงก็ได้ ทำข้าวคลุกก็หอม', SellingText: 'แนะนำชุดครัวใต้ครบเครื่องค่ะ ได้กะปิตาเว้ง 500 กรัม + กะปิขัดน้ำ ทำแกงก็ได้ ทำข้าวคลุกกะปิก็หอม ค่าส่ง 40 บาทเท่าเดิมค่ะ', Active: true, SortOrder: 50, Notes: '' }
  ];

  const bundleItems = [
    { BundleID: 'BUNDLE-RANONG-TRY', ProductID: 'KAPI-MAEDANG-200', Quantity: 1 },
    { BundleID: 'BUNDLE-RANONG-TRY', ProductID: 'KAPI-TAWENG-500', Quantity: 1 },
    { BundleID: 'BUNDLE-NAMPRIK-GAENGTAI', ProductID: 'KAPI-MAEDANG-500', Quantity: 1 },
    { BundleID: 'BUNDLE-NAMPRIK-GAENGTAI', ProductID: 'KAPI-TAWENG-500', Quantity: 1 },
    { BundleID: 'BUNDLE-PREMIUM-AROMA', ProductID: 'KAPI-MAEDANG-500', Quantity: 1 },
    { BundleID: 'BUNDLE-PREMIUM-AROMA', ProductID: 'KAPI-KHADNAM-SMALL', Quantity: 1 },
    { BundleID: 'BUNDLE-NAMPRIK-NUA', ProductID: 'KAPI-MAEDANG-200', Quantity: 1 },
    { BundleID: 'BUNDLE-NAMPRIK-NUA', ProductID: 'KAPI-KHADNAM-SMALL', Quantity: 1 },
    { BundleID: 'BUNDLE-SOUTHERN-KITCHEN', ProductID: 'KAPI-TAWENG-500', Quantity: 1 },
    { BundleID: 'BUNDLE-SOUTHERN-KITCHEN', ProductID: 'KAPI-KHADNAM-SMALL', Quantity: 1 }
  ];

  products.forEach(upsertProduct_);
  bundles.forEach(upsertBundle_);
  replaceBundleItems_(bundleItems);

  return { success: true, message: 'Seed catalog completed', products: products.length, bundles: bundles.length, bundleItems: bundleItems.length };
}

function createOrder(payload) {
  setupDatabase();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const rollbackAllocations = [];

  try {
    validateOrderPayload_(payload);
    const cartLines = buildCartLines_(payload.items);
    validateStockForCart_(cartLines);

    const customerShippingPaid = toNonNegativeNumber_(payload.customerShippingPaid, 'ค่าส่งที่เก็บลูกค้า');
    const actualShippingCost = toNonNegativeNumber_(payload.actualShippingCost, 'ค่าส่งจริง');
    const packagingCost = toNonNegativeNumber_(payload.packagingCost, 'ค่าแพ็กเกจจิ้ง');

    const orderId = generateId_('ORD');
    const now = new Date();
    let orderSubtotal = 0;
    let dealerCostTotal = 0;
    let landedCostTotal = 0;
    let yourMarginTotal = 0;
    const orderItemRows = [];

    cartLines.forEach(function(line) {
      const allocated = allocateLineFIFO_(line);
      flattenLineAllocations_(allocated.fifoObject).forEach(function(a) { rollbackAllocations.push(a); });
      orderSubtotal += line.lineTotal;
      dealerCostTotal += allocated.dealerCostTotal;
      landedCostTotal += allocated.landedCostTotal;
      yourMarginTotal += allocated.yourMarginTotal;
      orderItemRows.push({
        OrderItemID: generateId_('ITEM'), OrderID: orderId, LineType: line.lineType, ReferenceID: line.referenceId,
        DisplayName: line.displayName, ProductID: line.lineType === 'PRODUCT' ? line.productId : '',
        ProductName: line.lineType === 'PRODUCT' ? line.productName : '', Quantity: line.quantity,
        UnitPrice: line.unitPrice, LineTotal: line.lineTotal, FIFOAllocationJSON: JSON.stringify(allocated.fifoObject),
        DealerCostTotal: allocated.dealerCostTotal, LandedCostTotal: allocated.landedCostTotal,
        YourMarginTotal: allocated.yourMarginTotal, CreatedAt: now
      });
    });

    orderSubtotal = round2_(orderSubtotal);
    dealerCostTotal = round2_(dealerCostTotal);
    landedCostTotal = round2_(landedCostTotal);
    yourMarginTotal = round2_(yourMarginTotal);
    const orderGrandTotal = round2_(orderSubtotal + customerShippingPaid);
    const sellerNetProfit = round2_(orderGrandTotal - dealerCostTotal - actualShippingCost - packagingCost);
    const slipUrl = uploadBase64File_(payload.slipFile, 'ORDER_SLIP_' + orderId);

    appendObjectRow_(getSheet_(SHEET_NAMES.ORDERS), {
      OrderID: orderId, OrderDate: now, CustomerName: normalizeText_(payload.customerName),
      CustomerPhone: normalizeText_(payload.customerPhone), CustomerAddress: normalizeText_(payload.customerAddress),
      PaymentMethod: APP.DEFAULT_PAYMENT_METHOD, SlipImageURL: slipUrl, CustomerShippingPaid: customerShippingPaid,
      ActualShippingCost: actualShippingCost, PackagingCost: packagingCost, OrderSubtotal: orderSubtotal,
      OrderGrandTotal: orderGrandTotal, DealerCostTotal: dealerCostTotal, LandedCostTotal: landedCostTotal,
      YourMarginTotal: yourMarginTotal, SellerNetProfit: sellerNetProfit, SettlementID: '', OrderStatus: 'CONFIRMED',
      ExceptionStatus: 'NONE', Notes: normalizeText_(payload.notes || ''), CreatedAt: now, CreatedBy: 'GITHUB_FRONTEND'
    });

    const itemSheet = getSheet_(SHEET_NAMES.ORDER_ITEMS);
    orderItemRows.forEach(function(row) { appendObjectRow_(itemSheet, row); });

    return { success: true, message: 'บันทึกออเดอร์สำเร็จ', orderId: orderId, orderSubtotal: orderSubtotal, orderGrandTotal: orderGrandTotal, remainingData: getInitialData() };
  } catch (err) {
    if (rollbackAllocations.length) {
      try { restoreAllocationsToInventory_(rollbackAllocations); } catch (rollbackErr) { Logger.log(rollbackErr.message); }
    }
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (releaseErr) { Logger.log(releaseErr.message); }
  }
}

function addInventoryLot(payload, adminPin) {
  assertAdmin_(adminPin);
  setupDatabase();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const productId = normalizeText_(payload.productId);
    const productName = normalizeText_(payload.productName);
    if (!productId) throw new Error('กรุณาระบุ ProductID');
    if (!productName) throw new Error('กรุณาระบุ ProductName');
    const lotNumber = normalizeText_(payload.lotNumber || generateId_('LOT'));
    const dateReceived = parseDateOnly_(payload.dateReceived || new Date(), false);
    const initialQty = toPositiveNumber_(payload.initialQty, 'InitialQty');
    const companyCost = toNonNegativeNumber_(payload.companyCost, 'CompanyCost');
    const inboundShipping = toNonNegativeNumber_(payload.inboundShipping, 'InboundShipping');
    const yourMarginUnit = round2_(companyCost * APP.YOUR_MARGIN_RATE);
    const landedUnitCost = round2_(companyCost + inboundShipping);
    const dealerUnitCost = round2_(companyCost + yourMarginUnit + inboundShipping);

    if (!getProductByProductId_(productId)) {
      upsertProduct_({ ProductID: productId, ProductName: productName, SKU: productId, QRValue: 'PRODUCT:' + productId, NormalPrice: 0, HasHalal: true, Unit: 'ชิ้น', Active: true, SortOrder: 999 });
    }

    appendObjectRow_(getSheet_(SHEET_NAMES.INVENTORY), {
      ProductID: productId, ProductName: productName, LotNumber: lotNumber, DateReceived: dateReceived,
      InitialQty: initialQty, RemainingQty: initialQty, CompanyCost: companyCost, InboundShipping: inboundShipping,
      LandedUnitCost: landedUnitCost, YourMarginUnit: yourMarginUnit, DealerUnitCost: dealerUnitCost,
      Status: 'AVAILABLE', LastUpdated: new Date(), Notes: normalizeText_(payload.notes || '')
    });
    return { success: true, message: 'เพิ่ม Lot สำเร็จ', productId: productId, lotNumber: lotNumber, initialQty: initialQty, dealerUnitCost: dealerUnitCost };
  } finally {
    try { lock.releaseLock(); } catch (err) { Logger.log(err.message); }
  }
}

function validateOrderPayload_(payload) {
  if (!payload) throw new Error('ไม่พบข้อมูลออเดอร์');
  [['customerName','ชื่อลูกค้า'], ['customerPhone','เบอร์โทร'], ['customerAddress','ที่อยู่ลูกค้า']].forEach(function(pair) {
    if (!normalizeText_(payload[pair[0]])) throw new Error('กรุณากรอก: ' + pair[1]);
  });
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ');
  if (!payload.slipFile || !payload.slipFile.base64) throw new Error('ต้องอัปโหลดสลิปโอนเงินก่อนบันทึกออเดอร์');
  const method = normalizeText_(payload.paymentMethod || APP.DEFAULT_PAYMENT_METHOD);
  if (method && method !== APP.DEFAULT_PAYMENT_METHOD) throw new Error('ระบบรองรับเฉพาะ Bank Transfer เท่านั้น');
}

function buildCartLines_(items) {
  const productMap = getProductMap_();
  const bundleMap = getBundleMap_();
  const bundleItemsMap = getBundleItemsMap_();

  return items.map(function(item, idx) {
    const lineType = normalizeText_(item.lineType).toUpperCase();
    const referenceId = normalizeText_(item.referenceId);
    const quantity = toPositiveInteger_(item.quantity, 'จำนวนรายการที่ ' + (idx + 1));
    if (!referenceId) throw new Error('รายการที่ ' + (idx + 1) + ' ไม่มีรหัสอ้างอิง');

    if (lineType === 'PRODUCT') {
      const product = resolveProductByAnyCode_(referenceId, productMap);
      if (!product) throw new Error('ไม่พบสินค้า: ' + referenceId);
      if (!product.active) throw new Error('สินค้านี้ถูกปิดใช้งาน: ' + product.productName);
      const unitPrice = parseOptionalNonNegative_(item.unitPrice, product.normalPrice, 'ราคาขายสินค้า ' + product.productName);
      return { lineType: 'PRODUCT', referenceId: product.productId, displayName: product.productName, productId: product.productId, productName: product.productName, quantity: quantity, unitPrice: unitPrice, lineTotal: round2_(unitPrice * quantity), components: [{ productId: product.productId, productName: product.productName, quantity: quantity }] };
    }

    if (lineType === 'BUNDLE') {
      const bundle = bundleMap[referenceId];
      if (!bundle) throw new Error('ไม่พบโปรแพคคู่: ' + referenceId);
      if (!bundle.active) throw new Error('โปรนี้ถูกปิดใช้งาน: ' + bundle.bundleName);
      const components = bundleItemsMap[referenceId] || [];
      if (!components.length) throw new Error('โปรนี้ยังไม่มีรายการสินค้าใน BundleItems: ' + bundle.bundleName);
      const unitPrice = parseOptionalNonNegative_(item.unitPrice, bundle.bundlePrice, 'ราคาโปร ' + bundle.bundleName);
      return { lineType: 'BUNDLE', referenceId: bundle.bundleId, displayName: bundle.bundleName, productId: '', productName: '', quantity: quantity, unitPrice: unitPrice, lineTotal: round2_(unitPrice * quantity), components: components.map(function(c) { const product = productMap[c.productId]; if (!product) throw new Error('Bundle มี ProductID ที่ไม่มีใน Products: ' + c.productId); return { productId: c.productId, productName: product.productName, quantity: Number(c.quantity) * quantity }; }) };
    }

    throw new Error('LineType ต้องเป็น PRODUCT หรือ BUNDLE เท่านั้น');
  });
}

function validateStockForCart_(cartLines) {
  const needs = {};
  const stockMap = getStockMap_();
  cartLines.forEach(function(line) {
    line.components.forEach(function(c) { needs[c.productId] = (needs[c.productId] || 0) + Number(c.quantity || 0); });
  });
  Object.keys(needs).forEach(function(productId) {
    const available = stockMap[productId] ? stockMap[productId].availableQty : 0;
    if (needs[productId] > available) throw new Error('สต็อกไม่พอ: ' + getProductNameById_(productId) + ' ต้องใช้ ' + needs[productId] + ' ชิ้น แต่คงเหลือ ' + available + ' ชิ้น');
  });
}

function allocateLineFIFO_(line) {
  const fifoObject = { lineType: line.lineType, referenceId: line.referenceId, displayName: line.displayName, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal, components: [] };
  let dealerCostTotal = 0, landedCostTotal = 0, yourMarginTotal = 0;
  line.components.forEach(function(c) {
    const allocation = allocateInventoryFIFO_(c.productId, c.quantity);
    fifoObject.components.push({ productId: c.productId, productName: c.productName, quantity: c.quantity, allocations: allocation.allocations, dealerCostTotal: allocation.totalDealerCost, landedCostTotal: allocation.totalLandedCost, yourMarginTotal: allocation.totalYourMargin });
    dealerCostTotal += allocation.totalDealerCost;
    landedCostTotal += allocation.totalLandedCost;
    yourMarginTotal += allocation.totalYourMargin;
  });
  return { fifoObject: fifoObject, dealerCostTotal: round2_(dealerCostTotal), landedCostTotal: round2_(landedCostTotal), yourMarginTotal: round2_(yourMarginTotal) };
}

function flattenLineAllocations_(fifoObject) {
  const flat = [];
  if (!fifoObject || !Array.isArray(fifoObject.components)) return flat;
  fifoObject.components.forEach(function(c) { (c.allocations || []).forEach(function(a) { flat.push(a); }); });
  return flat;
}

function allocateInventoryFIFO_(productId, quantity) {
  const sheet = getSheet_(SHEET_NAMES.INVENTORY);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('ยังไม่มีข้อมูล Inventory');
  const h = getHeaderMap_(sheet);
  const lots = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (normalizeText_(row[h.ProductID]) !== productId) continue;
    const remainingQty = Number(row[h.RemainingQty]) || 0;
    if (remainingQty <= 0) continue;
    const status = normalizeText_(row[h.Status] || 'AVAILABLE').toUpperCase();
    if (status === 'INACTIVE' || status === 'DISABLED') continue;
    const rawDate = row[h.DateReceived];
    lots.push({ rowNumber: r + 1, productId: productId, productName: normalizeText_(row[h.ProductName]), lotNumber: normalizeText_(row[h.LotNumber]), dateReceived: rawDate instanceof Date ? rawDate : new Date(rawDate || '9999-01-01'), remainingQty: remainingQty, companyCost: Number(row[h.CompanyCost]) || 0, inboundShipping: Number(row[h.InboundShipping]) || 0 });
  }
  lots.sort(function(a, b) { const d = a.dateReceived.getTime() - b.dateReceived.getTime(); return d !== 0 ? d : a.rowNumber - b.rowNumber; });
  let needQty = quantity;
  const allocations = [];
  lots.forEach(function(lot) {
    if (needQty <= 0) return;
    const takeQty = Math.min(needQty, lot.remainingQty);
    const newRemaining = lot.remainingQty - takeQty;
    const yourMarginUnit = round2_(lot.companyCost * APP.YOUR_MARGIN_RATE);
    const landedUnitCost = round2_(lot.companyCost + lot.inboundShipping);
    const dealerUnitCost = round2_(lot.companyCost + yourMarginUnit + lot.inboundShipping);
    allocations.push({ productId: lot.productId, productName: lot.productName, lotNumber: lot.lotNumber, dateReceived: formatDate_(lot.dateReceived, 'yyyy-MM-dd'), qty: takeQty, companyCost: lot.companyCost, inboundShipping: lot.inboundShipping, landedUnitCost: landedUnitCost, yourMarginUnit: yourMarginUnit, dealerUnitCost: dealerUnitCost, landedCostTotal: round2_(landedUnitCost * takeQty), yourMarginTotal: round2_(yourMarginUnit * takeQty), dealerCostTotal: round2_(dealerUnitCost * takeQty) });
    sheet.getRange(lot.rowNumber, h.RemainingQty + 1).setValue(newRemaining);
    sheet.getRange(lot.rowNumber, h.Status + 1).setValue(newRemaining <= 0 ? 'OUT_OF_STOCK' : 'AVAILABLE');
    sheet.getRange(lot.rowNumber, h.LastUpdated + 1).setValue(new Date());
    needQty -= takeQty;
  });
  if (needQty > 0) throw new Error('FIFO allocation failed: สต็อกไม่เพียงพอสำหรับ ' + productId);
  SpreadsheetApp.flush();
  return { allocations: allocations, totalDealerCost: round2_(sum_(allocations, 'dealerCostTotal')), totalLandedCost: round2_(sum_(allocations, 'landedCostTotal')), totalYourMargin: round2_(sum_(allocations, 'yourMarginTotal')) };
}

function restoreAllocationsToInventory_(allocations) {
  if (!allocations || !allocations.length) return;
  const sheet = getSheet_(SHEET_NAMES.INVENTORY);
  const values = sheet.getDataRange().getValues();
  const h = getHeaderMap_(sheet);
  allocations.forEach(function(a) {
    const productId = normalizeText_(a.productId), lotNumber = normalizeText_(a.lotNumber), qty = Number(a.qty) || 0;
    if (!productId || !lotNumber || qty <= 0) return;
    let found = false;
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (normalizeText_(row[h.ProductID]) === productId && normalizeText_(row[h.LotNumber]) === lotNumber) {
        const newRemaining = (Number(row[h.RemainingQty]) || 0) + qty;
        sheet.getRange(r + 1, h.RemainingQty + 1).setValue(newRemaining);
        sheet.getRange(r + 1, h.Status + 1).setValue('AVAILABLE');
        sheet.getRange(r + 1, h.LastUpdated + 1).setValue(new Date());
        values[r][h.RemainingQty] = newRemaining;
        found = true;
        break;
      }
    }
    if (!found) throw new Error('ไม่พบ Lot ที่ต้องคืนสต็อก: ' + productId + ' / ' + lotNumber);
  });
  SpreadsheetApp.flush();
}

function getPublicProducts_() {
  const productMap = getProductMap_();
  const stockMap = getStockMap_();
  return Object.keys(productMap).map(function(productId) {
    const p = productMap[productId];
    const s = stockMap[productId] || { availableQty: 0, activeLots: 0, oldestLotDate: '' };
    return { productId: p.productId, productName: p.productName, sku: p.sku, barcodeValue: p.barcodeValue, qrValue: p.qrValue, size: p.size, normalPrice: p.normalPrice, shortSellingPoint: p.shortSellingPoint, tasteProfile: p.tasteProfile, bestForCustomer: p.bestForCustomer, recommendedMenus: p.recommendedMenus, hasHalal: p.hasHalal, unit: p.unit, active: p.active, sortOrder: p.sortOrder, availableQty: s.availableQty, activeLots: s.activeLots, oldestLotDate: s.oldestLotDate, sellingText: buildProductSellingText_(p) };
  }).filter(function(p) { return p.active; }).sort(function(a, b) { return (Number(a.sortOrder || 999) - Number(b.sortOrder || 999)) || a.productName.localeCompare(b.productName); });
}

function getPublicBundles_(publicProducts) {
  const bundleMap = getBundleMap_();
  const bundleItemsMap = getBundleItemsMap_();
  const productPublicMap = {};
  publicProducts.forEach(function(p) { productPublicMap[p.productId] = p; });
  return Object.keys(bundleMap).map(function(bundleId) {
    const b = bundleMap[bundleId];
    const components = (bundleItemsMap[bundleId] || []).map(function(c) { const p = productPublicMap[c.productId] || null; return { productId: c.productId, productName: p ? p.productName : c.productId, quantity: Number(c.quantity) || 0, availableQty: p ? Number(p.availableQty) || 0 : 0 }; });
    let availableQty = 0;
    if (components.length) availableQty = Math.min.apply(null, components.map(function(c) { return c.quantity ? Math.floor(c.availableQty / c.quantity) : 0; }));
    return { bundleId: b.bundleId, bundleName: b.bundleName, bundlePrice: b.bundlePrice, normalPrice: b.normalPrice, shippingFee: b.shippingFee, description: b.description, bestForCustomer: b.bestForCustomer, sellingText: b.sellingText, active: b.active, sortOrder: b.sortOrder, availableQty: availableQty, components: components };
  }).filter(function(b) { return b.active; }).sort(function(a, b) { return (Number(a.sortOrder || 999) - Number(b.sortOrder || 999)) || a.bundleName.localeCompare(b.bundleName); });
}

function getStockMap_() {
  const rows = getRowsAsObjects_(getSheet_(SHEET_NAMES.INVENTORY));
  const map = {};
  rows.forEach(function(row) {
    const productId = normalizeText_(row.ProductID);
    if (!productId) return;
    const status = normalizeText_(row.Status || 'AVAILABLE').toUpperCase();
    if (status === 'INACTIVE' || status === 'DISABLED') return;
    if (!map[productId]) map[productId] = { availableQty: 0, activeLots: 0, oldestLotDate: '' };
    const qty = Number(row.RemainingQty) || 0;
    if (qty > 0) {
      map[productId].availableQty += qty;
      map[productId].activeLots += 1;
      const dateValue = row.DateReceived instanceof Date ? formatDate_(row.DateReceived, 'yyyy-MM-dd') : normalizeText_(row.DateReceived);
      if (!map[productId].oldestLotDate || dateValue < map[productId].oldestLotDate) map[productId].oldestLotDate = dateValue;
    }
  });
  return map;
}

function buildProductSellingText_(p) {
  return 'แนะนำ' + p.productName + 'ค่ะ ' + (p.shortSellingPoint || '') + ' เหมาะกับ' + (p.bestForCustomer || 'ลูกค้าทั่วไป') + ' ใช้ได้กับเมนู ' + (p.recommendedMenus || 'แกงและเมนูทั่วไป') + (p.hasHalal ? ' มีฮาลาลค่ะ' : '');
}

function getProductMap_() {
  const rows = getRowsAsObjects_(getSheet_(SHEET_NAMES.PRODUCTS));
  const map = {};
  rows.forEach(function(row) {
    const id = normalizeText_(row.ProductID);
    if (!id) return;
    map[id] = { productId: id, productName: normalizeText_(row.ProductName || id), sku: normalizeText_(row.SKU), barcodeValue: normalizeText_(row.BarcodeValue), qrValue: normalizeText_(row.QRValue), size: normalizeText_(row.Size), normalPrice: Number(row.NormalPrice) || 0, shortSellingPoint: normalizeText_(row.ShortSellingPoint), tasteProfile: normalizeText_(row.TasteProfile), bestForCustomer: normalizeText_(row.BestForCustomer), recommendedMenus: normalizeText_(row.RecommendedMenus), hasHalal: String(row.HasHalal).toLowerCase() !== 'false', unit: normalizeText_(row.Unit || 'ชิ้น'), active: String(row.Active).toLowerCase() !== 'false', sortOrder: Number(row.SortOrder) || 999, notes: normalizeText_(row.Notes) };
  });
  return map;
}

function getBundleMap_() {
  const rows = getRowsAsObjects_(getSheet_(SHEET_NAMES.BUNDLES));
  const map = {};
  rows.forEach(function(row) {
    const id = normalizeText_(row.BundleID);
    if (!id) return;
    map[id] = { bundleId: id, bundleName: normalizeText_(row.BundleName || id), bundlePrice: Number(row.BundlePrice) || 0, normalPrice: Number(row.NormalPrice) || 0, shippingFee: Number(row.ShippingFee) || APP.DEFAULT_CUSTOMER_SHIPPING, description: normalizeText_(row.Description), bestForCustomer: normalizeText_(row.BestForCustomer), sellingText: normalizeText_(row.SellingText), active: String(row.Active).toLowerCase() !== 'false', sortOrder: Number(row.SortOrder) || 999, notes: normalizeText_(row.Notes) };
  });
  return map;
}

function getBundleItemsMap_() {
  const rows = getRowsAsObjects_(getSheet_(SHEET_NAMES.BUNDLE_ITEMS));
  const map = {};
  rows.forEach(function(row) {
    const bundleId = normalizeText_(row.BundleID), productId = normalizeText_(row.ProductID), quantity = Number(row.Quantity) || 0;
    if (!bundleId || !productId || quantity <= 0) return;
    if (!map[bundleId]) map[bundleId] = [];
    map[bundleId].push({ bundleId: bundleId, productId: productId, quantity: quantity });
  });
  return map;
}

function resolveProductByAnyCode_(code, productMap) {
  const input = normalizeText_(code);
  const normalized = normalizeProductCode_(input);
  const map = productMap || getProductMap_();
  if (map[input] || map[normalized]) return map[input] || map[normalized];
  const ids = Object.keys(map);
  for (let i = 0; i < ids.length; i++) {
    const p = map[ids[i]];
    const candidates = [p.productId, p.sku, p.barcodeValue, p.qrValue, normalizeProductCode_(p.qrValue)].map(normalizeText_);
    if (candidates.indexOf(input) >= 0 || candidates.indexOf(normalized) >= 0) return p;
  }
  return null;
}

function normalizeProductCode_(value) {
  const text = normalizeText_(value);
  return text.toUpperCase().indexOf('PRODUCT:') === 0 ? text.substring('PRODUCT:'.length).trim() : text;
}

function getProductByProductId_(productId) { return getProductMap_()[productId] || null; }
function getProductNameById_(productId) { const p = getProductByProductId_(productId); return p ? p.productName : productId; }

function upsertProduct_(p) {
  const sheet = getSheet_(SHEET_NAMES.PRODUCTS);
  const id = normalizeText_(p.ProductID);
  if (!id) throw new Error('ProductID ว่าง');
  const existing = getRowsAsObjects_(sheet).find(function(row) { return normalizeText_(row.ProductID) === id; });
  const obj = { ProductID: id, ProductName: normalizeText_(p.ProductName), SKU: normalizeText_(p.SKU), BarcodeValue: normalizeText_(p.BarcodeValue), QRValue: normalizeText_(p.QRValue), Size: normalizeText_(p.Size), NormalPrice: Number(p.NormalPrice) || 0, ShortSellingPoint: normalizeText_(p.ShortSellingPoint), TasteProfile: normalizeText_(p.TasteProfile), BestForCustomer: normalizeText_(p.BestForCustomer), RecommendedMenus: normalizeText_(p.RecommendedMenus), HasHalal: p.HasHalal === false ? false : true, Unit: normalizeText_(p.Unit || 'ชิ้น'), Active: p.Active === false ? false : true, SortOrder: Number(p.SortOrder) || 999, Notes: normalizeText_(p.Notes), CreatedAt: p.CreatedAt || new Date() };
  if (existing) updateRowByHeaders_(sheet, existing.__rowNumber, obj); else appendObjectRow_(sheet, obj);
}

function upsertBundle_(b) {
  const sheet = getSheet_(SHEET_NAMES.BUNDLES);
  const id = normalizeText_(b.BundleID);
  if (!id) throw new Error('BundleID ว่าง');
  const existing = getRowsAsObjects_(sheet).find(function(row) { return normalizeText_(row.BundleID) === id; });
  const obj = { BundleID: id, BundleName: normalizeText_(b.BundleName), BundlePrice: Number(b.BundlePrice) || 0, NormalPrice: Number(b.NormalPrice) || 0, ShippingFee: Number(b.ShippingFee) || APP.DEFAULT_CUSTOMER_SHIPPING, Description: normalizeText_(b.Description), BestForCustomer: normalizeText_(b.BestForCustomer), SellingText: normalizeText_(b.SellingText), Active: b.Active === false ? false : true, SortOrder: Number(b.SortOrder) || 999, Notes: normalizeText_(b.Notes), CreatedAt: b.CreatedAt || new Date() };
  if (existing) updateRowByHeaders_(sheet, existing.__rowNumber, obj); else appendObjectRow_(sheet, obj);
}

function replaceBundleItems_(items) {
  const sheet = getSheet_(SHEET_NAMES.BUNDLE_ITEMS);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  items.forEach(function(i) { appendObjectRow_(sheet, { BundleID: normalizeText_(i.BundleID), ProductID: normalizeText_(i.ProductID), Quantity: Number(i.Quantity) || 0 }); });
}

function getPendingSettlementPreview(periodStart, periodEnd, adminPin) {
  assertAdmin_(adminPin);
  const orders = getOrdersForSettlement_(periodStart, periodEnd);
  return { success: true, periodStart: periodStart, periodEnd: periodEnd, orderCount: orders.length, totals: summarizeSettlementOrders_(orders) };
}

function createSettlementForDateRange(periodStart, periodEnd, adminPin) {
  assertAdmin_(adminPin);
  setupDatabase();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const orders = getOrdersForSettlement_(periodStart, periodEnd);
    if (!orders.length) return { success: false, message: 'ไม่พบออเดอร์ที่รอตัดรอบในช่วงวันที่นี้' };
    const totals = summarizeSettlementOrders_(orders);
    const settlementId = generateId_('SET');
    const now = new Date();
    appendObjectRow_(getSheet_(SHEET_NAMES.SETTLEMENTS), { SettlementID: settlementId, DateRange: periodStart + ' ถึง ' + periodEnd, PeriodStart: parseDateOnly_(periodStart, false), PeriodEnd: parseDateOnly_(periodEnd, true), TotalDealerCost: totals.totalDealerCost, TotalYourNetProfit: totals.totalYourNetProfit, TotalLandedCost: totals.totalLandedCost, TotalSalesAmount: totals.totalSalesAmount, TotalSellerNetProfit: totals.totalSellerNetProfit, SellerTransferSlip: '', Status: 'PENDING_TRANSFER', OrderCount: orders.length, CreatedAt: now, PaidAt: '', Notes: '' });
    const sheet = getSheet_(SHEET_NAMES.ORDERS);
    const h = getHeaderMap_(sheet);
    orders.forEach(function(order) { sheet.getRange(order.__rowNumber, h.SettlementID + 1).setValue(settlementId); });
    return { success: true, message: 'สร้าง Settlement สำเร็จ', settlementId: settlementId, orderCount: orders.length, totalDealerCost: totals.totalDealerCost, totalYourNetProfit: totals.totalYourNetProfit };
  } finally { try { lock.releaseLock(); } catch (err) { Logger.log(err.message); } }
}

function markSettlementPaid(settlementId, transferSlipFile, adminPin) {
  assertAdmin_(adminPin);
  const sheet = getSheet_(SHEET_NAMES.SETTLEMENTS);
  const target = getRowsAsObjects_(sheet).find(function(row) { return normalizeText_(row.SettlementID) === normalizeText_(settlementId); });
  if (!target) throw new Error('ไม่พบ SettlementID: ' + settlementId);
  let slipUrl = target.SellerTransferSlip || '';
  if (transferSlipFile && transferSlipFile.base64) slipUrl = uploadBase64File_(transferSlipFile, 'SETTLEMENT_SLIP_' + settlementId);
  updateRowByHeaders_(sheet, target.__rowNumber, { SellerTransferSlip: slipUrl, Status: 'PAID', PaidAt: new Date() });
  return { success: true, message: 'บันทึก Settlement เป็น PAID แล้ว', settlementId: settlementId, sellerTransferSlip: slipUrl };
}

function setOrderException(payload, adminPin) {
  assertAdmin_(adminPin);
  const orderId = normalizeText_(payload.orderId);
  if (!orderId) throw new Error('กรุณาระบุ OrderID');
  const sheet = getSheet_(SHEET_NAMES.ORDERS);
  const order = getRowsAsObjects_(sheet).find(function(row) { return normalizeText_(row.OrderID) === orderId; });
  if (!order) throw new Error('ไม่พบ OrderID: ' + orderId);
  updateRowByHeaders_(sheet, order.__rowNumber, { OrderStatus: 'EXCEPTION', ExceptionStatus: normalizeText_(payload.exceptionStatus || 'CLAIM_PENDING'), Notes: appendNote_(order.Notes, normalizeText_(payload.notes || '')) });
  return { success: true, message: 'อัปเดตสถานะเคลมแล้ว', orderId: orderId };
}

function getOrdersForSettlement_(periodStart, periodEnd) {
  const startDate = parseDateOnly_(periodStart, false);
  const endDate = parseDateOnly_(periodEnd, true);
  return getRowsAsObjects_(getSheet_(SHEET_NAMES.ORDERS)).filter(function(row) {
    if (normalizeText_(row.SettlementID)) return false;
    const status = normalizeText_(row.OrderStatus).toUpperCase();
    if (status === 'CANCELLED' || status === 'VOID' || status === 'CANCELLED_BY_EXCEPTION') return false;
    const d = row.OrderDate instanceof Date ? row.OrderDate : new Date(row.OrderDate);
    return !isNaN(d.getTime()) && d >= startDate && d <= endDate;
  });
}

function summarizeSettlementOrders_(orders) {
  let dealer = 0, margin = 0, landed = 0, sales = 0, seller = 0;
  orders.forEach(function(row) { dealer += Number(row.DealerCostTotal) || 0; margin += Number(row.YourMarginTotal) || 0; landed += Number(row.LandedCostTotal) || 0; sales += Number(row.OrderGrandTotal) || 0; seller += Number(row.SellerNetProfit) || 0; });
  return { totalDealerCost: round2_(dealer), totalYourNetProfit: round2_(margin), totalLandedCost: round2_(landed), totalSalesAmount: round2_(sales), totalSellerNetProfit: round2_(seller) };
}

function uploadBase64File_(fileObj, prefix) {
  if (!fileObj || !fileObj.base64) throw new Error('ไม่พบไฟล์สลิป');
  const folder = DriveApp.getFolderById(getSlipFolderId_());
  let base64 = String(fileObj.base64);
  let mimeType = normalizeText_(fileObj.mimeType || 'image/jpeg');
  const m = base64.match(/^data:(.+);base64,(.*)$/);
  if (m) { mimeType = m[1]; base64 = m[2]; }
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > APP.MAX_UPLOAD_BYTES) throw new Error('ไฟล์สลิปใหญ่เกินกำหนด กรุณาใช้ไฟล์ไม่เกิน 8MB');
  const fileName = prefix + '_' + formatDate_(new Date(), 'yyyyMMdd_HHmmss') + '_' + sanitizeFileName_(fileObj.fileName || 'slip') + '.' + getExtensionFromMime_(mimeType);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  if (APP.MAKE_SLIPS_PUBLIC_WITH_LINK) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getSlipFolderId_() {
  const prop = normalizeText_(PropertiesService.getScriptProperties().getProperty('SLIP_FOLDER_ID'));
  if (prop) return prop;
  if (!APP.DRIVE_FOLDER_ID || APP.DRIVE_FOLDER_ID === 'PUT_YOUR_DRIVE_FOLDER_ID_HERE') throw new Error('ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID หรือ Script Property: SLIP_FOLDER_ID');
  return APP.DRIVE_FOLDER_ID;
}

function getExtensionFromMime_(mimeType) {
  const mime = normalizeText_(mimeType).toLowerCase();
  if (mime.indexOf('png') >= 0) return 'png';
  if (mime.indexOf('webp') >= 0) return 'webp';
  if (mime.indexOf('gif') >= 0) return 'gif';
  if (mime.indexOf('pdf') >= 0) return 'pdf';
  return 'jpg';
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = normalizeText_(props.getProperty('SPREADSHEET_ID')) || normalizeText_(APP.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('ไม่พบ Active Spreadsheet กรุณาผูก Apps Script กับ Google Sheets หรือระบุ SPREADSHEET_ID');
  return active;
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + name + ' กรุณา Run setupDatabase()');
  return sheet;
}

function ensureSheetWithHeaders_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(normalizeText_).filter(Boolean);
    const missing = headers.filter(function(h) { return current.indexOf(h) === -1; });
    if (missing.length) sheet.getRange(1, 1, 1, current.concat(missing).length).setValues([current.concat(missing)]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function(h, i) { const key = normalizeText_(h); if (key) map[key] = i; });
  return map;
}

function getRowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(normalizeText_);
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const obj = { __rowNumber: r + 1 };
    headers.forEach(function(h, c) { if (h) obj[h] = values[r][c]; });
    const hasAny = headers.some(function(h) { return h && obj[h] !== '' && obj[h] !== null && obj[h] !== undefined; });
    if (hasAny) rows.push(obj);
  }
  return rows;
}

function appendObjectRow_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalizeText_);
  sheet.appendRow(headers.map(function(h) { return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; }));
}

function updateRowByHeaders_(sheet, rowNumber, updates) {
  const h = getHeaderMap_(sheet);
  Object.keys(updates).forEach(function(key) { if (!h.hasOwnProperty(key)) throw new Error('ไม่พบคอลัมน์ ' + key + ' ใน Sheet ' + sheet.getName()); sheet.getRange(rowNumber, h[key] + 1).setValue(updates[key]); });
}

function logApi_(action, success, message, client, version) {
  try {
    appendObjectRow_(getSheet_(SHEET_NAMES.API_LOGS), { Timestamp: new Date(), Action: action, Success: success, Message: message, Client: client, Version: version });
  } catch (err) { Logger.log('API log failed: ' + err.message); }
}

function jsonOutput_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function normalizeText_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function sanitizeFileName_(name) { return normalizeText_(name).replace(/\.[^/.]+$/, '').replace(/[^\u0E00-\u0E7Fa-zA-Z0-9._-]+/g, '_').substring(0, 80) || 'file'; }
function toPositiveNumber_(v, label) { const n = Number(v); if (!isFinite(n) || n <= 0) throw new Error(label + ' ต้องเป็นตัวเลขมากกว่า 0'); return n; }
function toPositiveInteger_(v, label) { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new Error(label + ' ต้องเป็นจำนวนเต็มมากกว่า 0'); return n; }
function toNonNegativeNumber_(v, label) { const n = Number(v); if (!isFinite(n) || n < 0) throw new Error(label + ' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'); return n; }
function parseOptionalNonNegative_(v, fallback, label) { return v === undefined || v === null || String(v).trim() === '' ? round2_(fallback || 0) : round2_(toNonNegativeNumber_(v, label)); }
function round2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function sum_(items, key) { return items.reduce(function(total, item) { return total + (Number(item[key]) || 0); }, 0); }
function getTimeZone_() { return Session.getScriptTimeZone() || APP.DEFAULT_TIMEZONE; }
function formatDate_(date, pattern) { return Utilities.formatDate(date instanceof Date ? date : new Date(date), getTimeZone_(), pattern); }
function parseDateOnly_(value, endOfDay) { if (value instanceof Date) { const d = new Date(value); d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0); return d; } const p = normalizeText_(value).split('-').map(Number); if (p.length !== 3 || p.some(function(x) { return !isFinite(x); })) throw new Error('วันที่ต้องอยู่ในรูปแบบ yyyy-MM-dd เช่น 2026-05-27'); return new Date(p[0], p[1] - 1, p[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0); }
function generateId_(prefix) { return [prefix, formatDate_(new Date(), 'yyyyMMdd-HHmmss'), Utilities.getUuid().slice(0, 8).toUpperCase()].join('-'); }
function appendNote_(oldNote, newNote) { const oldText = normalizeText_(oldNote), newText = normalizeText_(newNote); if (!newText) return oldText; const appended = '[' + formatDate_(new Date(), 'yyyy-MM-dd HH:mm:ss') + '] ' + newText; return oldText ? oldText + '\n' + appended : appended; }
function getAdminPin_() { const pin = normalizeText_(PropertiesService.getScriptProperties().getProperty('ADMIN_PIN')) || normalizeText_(APP.ADMIN_PIN); if (!pin || pin === 'CHANGE_ME_ADMIN_PIN') throw new Error('ยังไม่ได้ตั้งค่า ADMIN_PIN'); return pin; }
function assertAdmin_(pin) { if (String(pin) !== String(getAdminPin_())) throw new Error('ADMIN_PIN ไม่ถูกต้อง'); }
function getApiToken_() { const token = normalizeText_(PropertiesService.getScriptProperties().getProperty('API_PUBLIC_TOKEN')) || normalizeText_(APP.API_PUBLIC_TOKEN); if (!token || token === 'CHANGE_ME_PUBLIC_TOKEN') throw new Error('ยังไม่ได้ตั้งค่า API_PUBLIC_TOKEN'); return token; }
function assertApiToken_(token) { if (String(token) !== String(getApiToken_())) throw new Error('API token ไม่ถูกต้อง'); }

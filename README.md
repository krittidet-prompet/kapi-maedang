# ระบบบริหารดีลสินค้า กะปิแม่แดง ระนอง v3.1

โครงนี้แยกหน้าเว็บไปไว้ GitHub Pages และให้ Google Apps Script เป็น API หลังบ้าน

## โครงสร้าง

```text
frontend/
  index.html
  app.js
  styles.css
  config.js
  .nojekyll
backend/
  Code.gs
docs/
  setup.md
```

## สถาปัตยกรรม

- Frontend: GitHub Pages
- Backend/API: Google Apps Script Web App
- Database: Google Sheets
- Slip Storage: Google Drive

## ขั้นตอนแบบย่อ

1. สร้าง Google Sheets
2. Extensions > Apps Script
3. วาง `backend/Code.gs`
4. ตั้ง Script Properties:
   - `API_PUBLIC_TOKEN`
   - `ADMIN_PIN`
   - `SLIP_FOLDER_ID`
5. Run `setupDatabase()`
6. Run `adminSeedKapiCatalogFromProperties()`
7. เพิ่ม Lot สินค้าด้วย `addInventoryLot()` หรือ `adminAddSampleLotsFromProperties()` สำหรับทดสอบ
8. Deploy Apps Script เป็น Web App แบบ `/exec`
9. นำ URL `/exec` ไปใส่ใน `frontend/config.js`
10. เปิด GitHub Pages จากโฟลเดอร์ `frontend`

> API_PUBLIC_TOKEN ที่อยู่ใน GitHub Pages ไม่ใช่ความลับจริง เพราะผู้ใช้เปิดดูได้ใน browser ใช้เป็นแค่ lightweight gate เท่านั้น ถ้าต้องการระบบล็อกอินจริงควรเพิ่ม Auth แยกในระยะถัดไป

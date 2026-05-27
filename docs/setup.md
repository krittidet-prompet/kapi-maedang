# Setup Guide v3.1 GitHub Frontend Edition

## 1) ตั้งค่า Apps Script Backend

เปิด Google Sheets > Extensions > Apps Script แล้ววางไฟล์ `backend/Code.gs`

ตั้ง Script Properties:

```text
API_PUBLIC_TOKEN = ตั้งค่าเป็นรหัสยาว ๆ เช่น kapi_2026_xxxxxxxxx
ADMIN_PIN = PIN หลังบ้านของคุณ
SLIP_FOLDER_ID = Folder ID ของ Google Drive ที่ใช้เก็บสลิป
```

Run ฟังก์ชันนี้ตามลำดับ:

```javascript
setupDatabase()
adminSeedKapiCatalogFromProperties()
```

สำหรับทดสอบสต็อก สามารถ Run:

```javascript
adminAddSampleLotsFromProperties()
```

แต่ก่อนใช้จริงให้แก้ต้นทุน Lot เป็นตัวเลขจริง

## 2) Deploy Apps Script เป็น API

Deploy > New deployment > Web app

ตั้งค่า:

```text
Execute as: Me / ฉัน
Who has access: Anyone / ทุกคน
```

หลัง Deploy ให้คัดลอก Web App URL ที่ลงท้ายด้วย `/exec`

## 3) ตั้งค่า Frontend

แก้ไฟล์ `frontend/config.js`

```javascript
window.KAPI_CONFIG = {
  GAS_API_URL: 'https://script.google.com/macros/s/xxxx/exec',
  API_PUBLIC_TOKEN: 'ต้องตรงกับ Script Property API_PUBLIC_TOKEN',
  APP_VERSION: '3.1.0'
};
```

## 4) อัปโหลดขึ้น GitHub Pages

สร้าง repository แล้วอัปโหลดไฟล์ในโฟลเดอร์ `frontend/`

เปิด Settings > Pages แล้วเลือก branch ที่เก็บไฟล์ frontend

## 5) ทดสอบ

1. เปิด URL GitHub Pages
2. ตรวจว่าสินค้าโหลดขึ้น
3. เพิ่มสินค้าเข้าตะกร้า
4. แนบสลิป
5. บันทึกออเดอร์
6. ตรวจ Google Sheets: Orders และ OrderItems
7. ตรวจ Google Drive ว่าสลิปถูกบันทึก

## 6) ถ้าเว็บโหลดไม่ได้

- ตรวจว่า `GAS_API_URL` เป็น URL `/exec` ไม่ใช่ `/dev`
- ตรวจว่า Apps Script Deploy เป็น Anyone
- ตรวจว่า `API_PUBLIC_TOKEN` ใน `config.js` ตรงกับ Script Properties
- กดปุ่ม “รีโหลดระบบ” บนหน้าเว็บ
- ถ้ายังติด CORS ให้ลอง Deploy Apps Script เป็น New Version แล้วนำ URL ใหม่มาใส่ใน `config.js`

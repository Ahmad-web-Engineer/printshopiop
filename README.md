# 🖨️ PrintShop Pro — Vercel + Google Apps Script

Frontend hosted on **Vercel** (static) · Backend powered by **Google Apps Script** REST API.

---

## Architecture

```
User's Browser
      │
      ▼
┌─────────────┐    fetch() POST     ┌──────────────────────┐
│   Vercel    │ ─────────────────▶  │  Google Apps Script  │
│  (Frontend) │  { action, args }   │   Web App (doPost)   │
│             │ ◀─────────────────  │                      │
│  /index     │   JSON response     │  • Google Sheets DB  │
│  /user      │                     │  • Google Drive      │
│  /admin     │                     │  • Gmail (emails)    │
│  /payment   │                     │  • Script Properties │
│  /adminpay  │                     │    (settings store)  │
└─────────────┘                     └──────────────────────┘
```

---

## Step 1 — Deploy Google Apps Script

### 1a. Create a new GAS project

1. Go to [script.google.com](https://script.google.com) → **New project**
2. Delete the default `Code.gs` content

### 1b. Add the script files

Create these files in your GAS project (use the **+** button):

| GAS File | Source File |
|---|---|
| `Code.gs` | `Code.gs` |
| `PaymentSystem.gs` | `PaymentSystem.gs` |

Paste the contents of each file.

### 1c. Set your Spreadsheet + Drive IDs

At the top of `Code.gs`, replace:

```js
const SS_ID     = 'YOUR_SPREADSHEET_ID';   // Google Sheets ID
const FOLDER_ID = 'YOUR_DRIVE_FOLDER_ID';  // Google Drive Folder ID
```

**Get Spreadsheet ID:** Create a new Google Sheet → copy the ID from the URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

**Get Folder ID:** Create a folder in Google Drive → copy from URL:
`https://drive.google.com/drive/folders/`**`THIS_PART`**

### 1d. Set admin credentials

In `Code.gs`:
```js
const ADMIN_CREDS = { email: 'your@email.com', password: 'YourPassword' };
```

### 1e. Set default shop info

```js
const SHOP = { name: 'Your Shop Name', upiId: 'yourname@paytm' };
```
*(You can change these later from the Admin → Settings page)*

### 1f. Run first-time setup

1. In GAS editor, select `fullSystemSetup` from the function dropdown
2. Click **Run**
3. Approve the permissions popup (Drive, Sheets, Gmail)
4. You should see `✅ All sheets created!` in the logs

### 1g. Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon ⚙️ → Select type: **Web app**
3. Set:
   - **Description:** `PrintShop Pro API v3`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone` *(required for Vercel to reach it)*
4. Click **Deploy**
5. **Copy the Web App URL** — looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

> ⚠️ **Every time you change Code.gs or PaymentSystem.gs**, you must create a **New Deployment** (not update existing) for changes to take effect on the live URL.

---

## Step 2 — Configure the Frontend

Open `js/config.js` and paste your GAS Web App URL:

```js
window.GAS_API_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

---

## Step 3 — Deploy to Vercel

### Option A — Vercel CLI (fastest)

```bash
npm i -g vercel
cd printshop-pro
vercel
```

Follow the prompts. Your site will be live at `https://your-project.vercel.app`.

### Option B — Vercel Dashboard (no CLI)

1. Push this folder to a **GitHub repo**
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repo
4. Framework preset: **Other** (it's a plain static site)
5. No build command needed — leave blank
6. Output directory: leave blank (root)
7. Click **Deploy**

### Option C — Drag and Drop

1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag your project folder into the upload area
3. Done ✅

---

## File Structure

```
printshop-pro/
│
├── index.html          ← Login / Register / Admin login
├── user.html           ← User dashboard + order wizard
├── admin.html          ← Admin panel + Settings page
├── payment.html        ← UPI QR payment flow
├── adminpayments.html  ← Payment ledger + fraud analytics
│
├── js/
│   ├── config.js       ← ⚠️ UPDATE THIS with your GAS URL
│   └── api.js          ← Fetch wrapper + google.script.run shim
│
├── vercel.json         ← Clean URL routing
│
├── Code.gs             ← GAS backend (upload to GAS project)
└── PaymentSystem.gs    ← GAS payment system (upload to GAS project)
```

---

## Pages & Routes

| URL | Page | Access |
|---|---|---|
| `/` | Login / Register | Public |
| `/user` | User Dashboard | Logged-in users |
| `/admin` | Admin Panel + Settings | Admin only |
| `/payment` | UPI Payment | Logged-in users |
| `/adminpayments` | Payment Ledger | Admin only |

---

## How the API Works

All frontend → backend communication uses a single POST endpoint:

```
POST https://script.google.com/macros/s/YOUR_ID/exec
Content-Type: text/plain

{ "action": "loginUser", "args": ["user@example.com", "password123"] }
```

Response:
```json
{ "ok": true, "user": { "id": "USR_...", "name": "John" }, "token": "uuid..." }
```

The `js/api.js` file provides a `google.script.run` shim so the existing code works without changes:

```js
// This existing code works as-is on Vercel:
google.script.run
  .withSuccessHandler(r => console.log(r))
  .withFailureHandler(e => console.error(e))
  .loginUser('email@test.com', 'pass');
```

---

## Admin Settings (No Code Editing Needed)

After deploying, log in as admin and go to **Settings ⚙️** to change:

- Shop name and UPI ID
- All pricing (base fee, per-page rates, A3/custom multipliers, urgent/delivery fees)
- Payment verification thresholds (QR expiry, retry limit, auto-approve score)

Settings are saved in GAS Script Properties and take effect immediately.

---

## Troubleshooting

### "API not configured" error
→ You didn't update `js/config.js` with your GAS Web App URL.

### CORS error in browser console
→ Make sure your GAS deployment is set to **"Who has access: Anyone"** (not "Only myself").

### Functions not found / old behavior
→ After changing GAS code, you must create a **New Deployment** in GAS. Updating an existing deployment does NOT update the live URL.

### "Sheet not found" error
→ Run `fullSystemSetup()` from the GAS editor to create all required sheets.

### Payments not sending emails
→ First run of Gmail requires manual permission. Run any function in GAS editor → approve Gmail permission.

### File uploads failing
→ Check that `FOLDER_ID` is correct and the script has Drive permission (run any function in GAS editor to trigger auth).

---

## Security Notes

- Admin session tokens expire after **8 hours**
- User session tokens expire after **24 hours**
- All passwords are SHA-256 hashed before storage
- Payment fraud scoring runs on every submission
- Never commit `config.js` with a real API key to a public repo — or use Vercel Environment Variables instead:
  ```js
  // In config.js, use a build-time replacement or load from meta tag
  window.GAS_API_URL = document.querySelector('meta[name="gas-url"]')?.content || '';
  ```

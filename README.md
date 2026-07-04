# UWAT Website — Umoja wa Wastaafu TANAPA

A fully functioning website with member registration and an admin dashboard.

## How to start the website (on your computer)

1. Open **PowerShell** (press Windows key, type "powershell", press Enter)
2. Run these two commands:

```
cd "C:\Users\M I C R O S P A C E\Documents\uwat-website"
npm start
```

3. Open your browser and go to:
   - **Website:** http://localhost:3000
   - **Admin dashboard:** http://localhost:3000/admin

To stop the server, press `Ctrl + C` in PowerShell.

## Admin login

- The admin password is: `uwat@2026`
- **IMPORTANT: change it before putting the site online.**
  Open `server.js` in Notepad, find this line near the top, and change the password:

```js
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'uwat@2026'; // <-- CHANGE THIS
```

## What the admin can do

- See every person who registered (with all their details — click a row to see everything)
- Search by name, phone, region, or park
- Approve (✔) or reject (✖) applications
- Delete (🗑) entries
- Download everything as an Excel file (the "Pakua Excel (CSV)" button)

## Where is the data stored?

All registrations are saved in the file `uwat.db` in this folder.
**Back this file up regularly** — copy it to a flash drive or Google Drive.
If you delete it, all registrations are gone.

## Folder guide

| File | What it is |
|---|---|
| `server.js` | The server — saves registrations, protects the admin area |
| `public/index.html` | The main website page |
| `public/admin.html` | The admin dashboard |
| `public/images/` | All photos and the UWAT logo |
| `uwat.db` | The database (created automatically on first registration) |

## Putting it online (free hosting)

The site is ready to deploy to services like **Render** or **Railway**.
One important note: on free hosting plans the database file can be erased
when the service restarts, so before going live you should either:
- attach a persistent disk (small monthly cost), or
- connect a free online database (e.g. Neon Postgres)

Ask Claude to help you with this step when you are ready to go live.

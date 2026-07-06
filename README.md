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

## Admin accounts (two levels)

**Super admin** — username `superadmin`. The password comes from Render's
settings (`SUPER_ADMIN_PASSWORD`, or the older `ADMIN_PASSWORD` setting;
on your own computer it is `uwat@2026`). The super admin can:
- Everything a normal admin can do (below), plus:
- Delete registration entries (🗑)
- Add and remove normal admins (the "Wasimamizi" tab)
- Reset any admin's password
- See the activity log (the "Kumbukumbu" tab): who logged in,
  who approved/rejected/deleted what, and when

**Normal admins** — created by the super admin from the "Wasimamizi" tab.
Give each leader their own username and starting password. They can:
- See and search every person who registered (click a row for full details)
- Approve (✔) or reject (✖) applications
- Download the Excel file
- Change their own password (the 🔑 button)
They can NOT delete anything, manage admins, or see the activity log.

If an admin forgets their password, the super admin resets it from the
"Wasimamizi" tab. If YOU forget the super admin password, change the
`SUPER_ADMIN_PASSWORD` value in Render → your service → Environment.

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

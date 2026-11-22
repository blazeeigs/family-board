# Family Board: setup

The board is a static web page (in `docs/`, served by GitHub Pages). It works straight away in **demo mode**, which keeps data on the one device.
To share it between the family, connect it to a Google Sheet through a small Google Apps Script web app. All family data lives in that Sheet and the shared Google Calendar, never in this repository.

## 1. Create the Sheet and script
1. Signed in to the Google account that owns the family calendar, create a new Google Sheet (name it anything, for example "Family board").
2. In the Sheet, open **Extensions > Apps Script**.
3. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
4. Click **Project Settings** (gear icon), tick **Show "appsscript.json" manifest file in editor**, then replace `appsscript.json` with [`apps-script/appsscript.json`](apps-script/appsscript.json). This sets the time zone to Europe/London.

## 2. Set the PIN and calendar
In **Project Settings > Script properties**, add:

| Property | Value |
|---|---|
| `PIN` | the family PIN (numbers are easiest on a tablet) |
| `CALENDAR_ID` | the shared calendar's id (Google Calendar > the calendar's **Settings and sharing** > **Integrate calendar** > Calendar ID) |

Without `CALENDAR_ID`, events are stored in the Sheet's Events tab instead of Google Calendar.

## 3. Run setup once
1. Back in the editor, choose the `setup` function and click **Run**. Approve the permissions prompt (Sheets and Calendar).
2. Run `testCalendar` and check the log says `OK: <calendar name>`.

## 4. Deploy the web app
1. **Deploy > New deployment**, type **Web app**.
2. **Execute as: Me**, **Who has access: Anyone**. (Anyone can reach the URL, but every request needs the PIN, and 10 wrong PINs lock it for 10 minutes.)
3. Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

After changing `Code.gs` later, use **Deploy > Manage deployments > Edit > Version: New version** so the URL stays the same.

## 5. Connect the board
On each device: open the board, tap **⚙︎ Settings**, paste the Web app URL, enter the PIN, choose who you are, and **Save**.
(Optionally put the URL in `docs/config.js` as `apiUrl` so new devices only need the PIN. The URL is not secret on its own, but keep the PIN out of the repo.)

## 6. Import starting data (optional)
Settings > **Import data (JSON)** accepts a JSON file shaped like:

```json
{
  "settings": { "title": "Family Board", "members": ["Name 1", "Name 2", "Name 3"] },
  "events":   [{ "title": "", "date": "YYYY-MM-DD", "time": "HH:MM", "end": "HH:MM", "location": "", "notes": "" }],
  "shopping": [{ "item": "", "qty": "", "category": "Fruit & veg", "note": "", "by": "" }],
  "todos":    [{ "task": "", "assignee": "", "due": "YYYY-MM-DD" }],
  "meals":    [{ "date": "YYYY-MM-DD", "title": "", "serves": "", "notes": "", "recipes": [{ "name": "", "by": "", "url": "", "ingredients": [] }] }],
  "trips":    [{ "name": "", "when": "", "status": "Planning", "details": "" }],
  "notes":    [{ "text": "", "pinned": false }]
}
```

Importing skips anything already there (same title and date), and events go into the Google calendar.

## Add to home screen / kitchen screen
- **iPhone/iPad (Safari):** Share > Add to Home Screen.
- **Android / Fire tablet (Chrome or Silk):** menu > Add to Home screen / Install app.
- **Kitchen screen:** open the board with `?kiosk=1` on the end of the address (or tick *Kitchen screen mode* in Settings). It shows bigger text, keeps the screen awake where the browser allows, and refreshes every minute.

## API (for reference)
- `GET <url>?action=all&pin=…` returns everything.
- `POST <url>` with a `text/plain` JSON body `{pin, by, action, type, id, item}`; `action` is `add`, `update`, `delete`, `toggle` or `import`. Types: `events`, `shopping`, `todos`, `meals`, `trips`, `notes`.

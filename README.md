# Cadence

A build-free task app: plain HTML, CSS and JavaScript files. No bundler, no npm install.

- **Tasks**: natural-language quick add, inventory summary, filters, grouping, agenda and table layouts, swipe gestures on phones
- **Calendar**: month and week views; drag tasks between days or onto "Unscheduled"
- **Sharing**: assign a task to anyone who has signed in with Google; they see it in their own list
- **Insights**: completed vs. added per week, on-time rate, streak, a daily activity heatmap, and breakdowns by type, importance, overdue age and shared tasks
- **Chart builder**: drag fields (type, importance, status, dates, assignee…) onto X axis, Values and Split by to make column, bar, line, area, pie, donut and scatter charts; save favorites to a board
- **Chart builder extras**: map fields (cluster, branch, node, depth), a sunburst that follows the map's tree, KPI tiles (one number with an 8-week trend and change vs last week), and goal lines that fade the bars that miss
- **Over time**: Burn-up (added vs. done, and whether your open list is growing) and Flow (done / open / overdue stacked over time)
- **Reading charts**: compare with the previous period (faint bars or a dashed line), rolling-average or straight-line trends, and a one-sentence summary under every chart
- **Filters**: narrow any chart by type, importance, map cluster, map branch or person; on Dashboards, one date range can apply to every chart
- **Treemap and Handoffs**: a treemap sizes boxes by type (or any category) with smaller boxes inside for a second field; Handoffs draws bands from who assigned each task to who's doing it
- **Exploring**: click a legend entry to show only that series (or highlight one slice), and drag across a time chart to zoom into a stretch of dates (swipe sideways on touch screens)
- **Export**: download any chart as a PNG picture or its numbers as a CSV file, from the Chart builder or a dashboard chart's ⋯ menu
- **Table**: list the tasks themselves. Pick the columns (any field, plus time and notes), reorder them, sort by clicking a header, group rows by a category, and filter by status, dates, type, importance, map, person, when it's due (overdue, today, next 7 or 30 days, no date) or words in the title or notes. Tick tasks off or open them right from the table, on dashboards too; export as CSV or PNG
- **Ask for a chart**: type what you want at the top of the Chart builder ("overdue tasks by branch this month", "average days late per month", "done per week with a goal of 5") and it sets the fields, chart type, filters, dates and goal for you
- **Rescheduling**: from v19, every time a task's due date moves to another date it's counted, along with how many days it was pushed back. Chart it with Times rescheduled, Days pushed back or the Rescheduled field (never / once / 2–3 / 4+); the task editor shows the count, and the Excel export has a column for it. Only changes made from v19 on are counted
- **Canvas heat overlay**: color every node by open tasks, overdue tasks, days late, age, % on time or recent completions, optionally rolled up through each branch
- **Dashboards**: as many as you like, private to you and synced to your account. Each lays out your saved charts and text blocks on a grid 24 squares across: **Edit dashboard**, then drag a chart by its handle to move it or by its corner to resize it (arrow keys work too). One chart can sit on several dashboards. **Set as home** picks the one that opens first. Tap any bar, slice or point to open the tasks behind it; on phones each chart is a small card (tap for its tasks, press and hold for the numbers)
- **Map: Canvas, Outline, Table**: one mind map shown three ways. The canvas has nodes in eight shapes, colors and fills, connections and dotted flows, fold/focus/tidy for branches, box select, a minimap, a node inspector, undo/redo, and PNG export. The outline is a keyboard-driven indented list with PDF export. The table lets you sort, filter, edit cells inline and change many nodes at once
- **Tasks on the map**: link any task to a node (in the editor, or with `@node` in quick add). Nodes show their open-task count, the inspector lists their tasks, and the Tasks page can filter by node or group by map cluster
- **Settings**: task types (name, color, icon, order), importance levels (name, color, rank, default), theme, week start, backup and restore

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
npx serve .            # or: python3 -m http.server 8080
```

With no Firebase config, tasks are saved in that browser's local storage.

## Quick-add syntax

| Type this            | You get                                  |
|----------------------|------------------------------------------|
| `tomorrow`, `fri`, `next week`, `in 3 days`, `oct 14`, `10/14` | due date |
| `3pm`, `9:30am`, `15:00`, `noon`, `tonight` | time (a time alone means today) |
| `#work`              | task type (prefix match on the name)     |
| `!high`, `!1`, `!!`  | importance (`!1` / `!!` = top level)     |
| `every week`, `daily`, `every weekday`, `monthly` | repeat |
| `@garage`, `@q4-roadmap` | link to a map node (prefix match on its name) |

## Keyboard

`N` new task (a new node on map pages) · `/` search · `⌘K` / `Ctrl K` command menu · `1`–`6` Tasks, Calendar, Canvas, Outline, Table, Insights · `←` `→` move the calendar · `T` today · `D` dark mode · `X` complete focused task · `⌘↵` save in the editor

On the canvas: `Tab` add child · `↵` add sibling · `F2` edit · `V` `H` `C` `A` select, pan, connect, flow · hold `Space` to pan · `F` focus branch · `.` fold · arrows nudge · `-` `=` `0` zoom · `⌘Z` / `⌘⇧Z` undo and redo map changes. In the outline: `↵` rename / new sibling, `Tab` / `⇧Tab` indent / outdent, `Alt ↑` `Alt ↓` move, `←` `→` fold, `⌘↵` show on canvas.

## Turn on sign-in and sync (Firebase)

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method**: enable **Google** and/or **Email/Password**.
3. **Firestore Database → Create database** (production mode).
4. **Project settings → Your apps → Web app (`</>`)**: register an app and copy its config object into `firebase-config.js`.
5. **Authentication → Settings → Authorized domains**: add the domain you'll host on (`localhost` is there by default).
6. Deploy the rules (and optionally host the app):

```sh
npm i -g firebase-tools
firebase login
firebase use --add                 # pick your project
firebase deploy --only firestore:rules
firebase deploy --only hosting     # optional: hosts this folder
```

Once configured, the app shows a sign-in screen. Data is stored like this:

```
tasks/{taskId}               every task; members = [owner] or [owner, assignee]; optional nodeId
users/{uid}/items/settings   your types, importance levels, defaults (private)
users/{uid}/items/map        your map: nodes + edges (private)
users/{uid}/items/board      saved charts and your dashboards (private)
people/{email}               { uid, name }, so others can assign you tasks by email
```

`firestore.rules` makes each task visible only to its owner and its assignee, validates the shape and size of every write, and denies all other paths.

## Formwright shares this project

Formwright (the form builder) runs on the same Firebase project, with the same accounts, from its own repo and Hosting site. **This folder holds the rules for both apps**: `firestore.rules`, `storage.rules` and `firestore.indexes.json` cover Cadence's tasks and Formwright's forms, records, groups and uploads. Always deploy rules from here; Formwright's repo deploys only its web pages.

Formwright's data:

```
forms/{formId}               form designs (admins write; everyone signed in reads)
records/{id}                 form entries, checked against users/{uid}.access
groups/{id}                  security groups (admins only)
users/{uid}                  Formwright account: role, groups, effective access
profiles/{uid}               display names for "Created by"
reports/{id}                 saved reports: the owner writes; shared ones readable by members
imports/{id}                 spreadsheet imports, kept 7 days for undo (admins only)
imports/{id}/before/{recId}  a record as it was before an import changed it (admins only)
uploads/... (Storage)        files attached to records
```

`users/{uid}` (Formwright's account document) and `users/{uid}/items/...` (Cadence's private settings, map and board) are separate documents with separate rules. Formwright admins can read the account document, never Cadence's private items.

### Linking tasks to records

A task can link to one Formwright record through `recordId`, `formId` and `recordSnap` (a copy of the record's title and the form's name and colour, so an assignee without access to that form still sees what the task is about).

- Only the task's owner can set, change or clear the link, and only to a record they can see in Formwright.
- The assignee can't change the link.
- A repeating task's next occurrence keeps its link, even if the record has since been deleted.
- Deleting a record leaves its tasks in place.

Using it (version 22):

- **Task editor → On a record**: pick from the records you can see in Formwright, grouped by form. Unlink with ×, or **Open in Formwright**. An assignee sees the record read-only.
- **Quick add**: `&acme` links the record whose title starts with "acme", like `@node` for the map.
- **Tasks page**: each linked task shows a chip in its form's color. Tap it to open the record in Formwright or to show only that record's tasks. Form chips in the filter row narrow the list to one form's records, and **Group: Form** groups by form. Search also matches record titles.
- If a record is deleted in Formwright, its tasks show **Record removed**.
- Opening one of your linked tasks refreshes the saved copy of the record's title.
- Formwright can link into Cadence: `?addTaskFor=<recordId>` opens a new task already linked to that record, and `?record=<recordId>` shows that record's tasks.

To open records in Formwright, add its address to `firebase-config.js`:

```js
window.CADENCE_FORMS_URL = 'https://cadence-forms.web.app/';
```

Cadence reads Formwright's forms and your Formwright account (`users/{uid}`) to know which records you can see. If you've never opened Formwright, there's nothing to pick from yet.

### Deploying rules

From this folder, in Cloud Shell:

```sh
(cd tests && npm install && npm test)     # rules tests against the emulators (needs Java, which Cloud Shell has)
(cd tests && npm run test:unit)           # dashboard layout tests (no emulator needed)
firebase deploy --only firestore:rules,firestore:indexes,storage --project tasks-2ae9d
```

The first deploy with `storage.rules` asks to let Storage read Firestore. Accept: the upload rules check Formwright access.

`tests/` is for development only. The app itself still has no build step, and `tests/` doesn't need uploading to your web host.

## The map

Canvas, Outline and Table show the same map. It's saved in one private document per account and syncs like your settings. A Firestore document holds up to 1 MB, which is roughly 3,000 nodes; the app warns you as you get close. View state (pan and zoom, folded branches, hidden clusters, table columns) stays on each device.

- **Clusters** are all the nodes that share a color. On map pages the sidebar lists them: click one to select it on the canvas or to filter the outline and table, use the eye to hide it on the canvas, and right-click to recolor the whole cluster. The sidebar collapses to an icon rail (the button next to the logo) to give the canvas more room.
- **Linking tasks.** In the task editor, **On the map** picks a node. Deleting a node doesn't delete its tasks. They stay on your list, and Undo puts the node and the links back. Only tasks you own link to your map; a task someone assigned you points at their map, so it shows no node for you.
- **Moving from Workmap.** In Workmap choose **Export → Download backup (.json)**, then in Cadence open **Settings → Map → Import a Workmap backup** (or use the button on the empty canvas). That replaces the map, and Workmap's tasks become Cadence tasks linked to the same nodes, with their due dates, completion and notes. Importing the same file again won't duplicate tasks. If both apps run on the same domain, Cadence also offers to bring the board in straight from the browser.
- The Workmap board was one board shared by everyone who signed in to it. In Cadence each account has its own map.

## Push notifications

Cadence can send reminders and updates as push notifications to any browser or phone you turn them on for:

- **Due-time reminders**: at a task's time (or 5–60 minutes before), for tasks you're doing
- **Morning summary**: at a time you pick, tasks due today with no time and anything overdue
- **Assigned to me**: when someone gives you a task
- **My shared task is done**: when the person you gave a task to finishes it

How it fits together: the app asks for permission and saves this device's push token to `notify/{uid}/devices/…`; Cloud Functions in `functions/` watch tasks and run every 5 minutes, then send through Firebase Cloud Messaging; `firebase-messaging-sw.js` shows the notification and opens the task when it's tapped.

### One-time setup

1. **Switch the project to the Blaze plan.** Firebase console → ⚙ → *Usage and billing* → *Details & settings* → *Modify plan*. Cloud Functions need it. A personal setup stays well inside the free allowance (reminders run 288 times a day). Set a budget alert (for example $1) on the same page so nothing surprises you.
2. **Create the Web Push key.** ⚙ *Project settings* → *Cloud Messaging* → *Web configuration* → *Web Push certificates* → **Generate key pair**. Copy the key and add one line to your `firebase-config.js`:
   ```js
   window.CADENCE_VAPID_KEY = 'BEl62…the key you copied…';
   ```
3. **Match the functions to your database's region.** Firebase console → *Firestore Database* shows the location next to the database. Put the matching region in `functions/.env` (`nam5` → `us-central1`, `northamerica-northeast1` → `northamerica-northeast1`, and so on).
4. **Deploy** from this folder (the first line installs what the functions need; run it again whenever `functions/package.json` changes):
   ```sh
   (cd functions && npm install)
   firebase deploy --only firestore:rules,firestore:indexes,functions
   ```
   The first functions deploy turns on several Google Cloud APIs and can take a few minutes. If it stops with a permissions or "service agent" error, wait two or three minutes and run it again. The new index (`tasks`: members + due) also takes a few minutes to build; reminders start once it's ready.
5. **Upload the app files** wherever you host it (Firebase Hosting, GitHub Pages…). It must be served over **https**, and `firebase-messaging-sw.js`, `push.js`, `manifest.webmanifest` and the icon PNGs must sit in the same folder as `index.html`.

### Turning it on, on each device

Open **Settings → Notifications → Turn on for this device**, allow notifications, then press **Send a test**. Do this on every computer and phone you want notifications on.

- **iPhone and iPad** (iOS 16.4 or later): web notifications only work from an installed app. In Safari, tap **Share → Add to Home Screen**, open Cadence from the new icon, sign in, and turn notifications on there.
- **Android**: works in Chrome. Installing it (menu → *Add to Home screen*) gives it its own icon, but isn't required.
- If you turned notifications down by mistake, allow them again in the browser's site settings and reload.

### If something doesn't arrive

- `firebase functions:log` shows what the functions did, including failed sends.
- "Firestore refused to save this device" means the rules from this version aren't deployed yet.
- Reminders can arrive up to 5 minutes late (that's how often the check runs). Times use the time zone of the device you last turned notifications on from, shown in Settings.
- Notifications include task names, which can show on a locked screen.

## Assigning tasks

In the task editor, **Assigned to** shows "Me", the people you've worked with recently, and an email box. Type someone's email and press **Assign**.

- The person must have signed in to Cadence once. Signing in lists their email in the `people` directory. Directory entries can be looked up one exact email at a time, never listed, and only verified addresses can claim one. Every Google account is verified; email/password users need to verify their address first.
- **The owner** can change anything, reassign, or delete.
- **The assignee** can complete the task, change its date and time, and edit the checklist and notes. Title, type, importance and repeat are read-only for them. They can't delete it, but they can **Hand back** the task to the owner.
- The assignee sees the owner's type and importance names and colors, even if their own settings differ.
- Completing a repeating task as the assignee creates the next occurrence for the same owner and assignee.
- The app shows a notice when someone assigns you a task, and when an assignee completes or hands back one of yours. Use the **Assigned to me** / **Assigned to others** filters on the Tasks page to see just those.
- **Version 24** turns the Board into **Dashboards**: several per person, each a grid you arrange by dragging and resizing. **Deploy the new `firestore.rules` before uploading the new files**: the old rules reject a board that holds dashboards. Your existing board opens as a dashboard called "My board" (sections become headings; small, medium and wide cards become 8, 12 and 24 squares across). Nothing is saved in the new shape until you change something, so nothing is lost if you go back. New charts from the Chart builder go on the dashboard you last opened.
- **Version 22** links tasks to Formwright records (see "Linking tasks to records"). **Deploy the new `firestore.rules` before uploading the new files**: the old rules reject tasks with a record link.
- **Version 16** adds burn-up and flow charts, period comparison, trend lines, chart summaries, chart filters and a Board-wide date range. No rules change.
- **Version 15** adds the sunburst, KPI tiles, goals and the canvas heat overlay. No rules change.
- **Version 14 syncs the Board.** Saved charts used to live in one browser. Now they're saved to your account, private to you, and follow you to every device. The first time each browser opens version 14, its saved charts are added to your account's board (duplicates are skipped). Deploy the new `firestore.rules` first, or the board can't be saved.
- **Version 13 adds the map. Deploy the new `firestore.rules` before uploading the new files**: the old rules reject the map document and any task with a `nodeId`.
- Version 8 moves tasks from the old `users/{uid}/items/{taskId}` location to `tasks/` automatically the first time each person signs in. **Deploy the new rules before uploading the new files**, or the move fails (nothing is lost; the app says so and offers Retry). After the move, the old location no longer accepts task writes, so an outdated open tab gets a sync error until it reloads.

The Firebase web config values are public identifiers, not secrets. Access control comes from the rules. For extra protection against abuse, turn on **App Check** in the console.

If a user had tasks in the browser before signing in for the first time, they are uploaded to that user's new, empty account. A different account signing in on the same browser starts fresh. Signing out clears the local copy.

## Files

The app's files sit in one folder, so it uploads to GitHub as-is. Two subfolders aren't part of the app: `functions/` is the push notification server code, deployed with the Firebase CLI, and `tests/` holds the rules tests. Neither needs uploading to your web host.

```
index.html
tokens.css            color, type and spacing tokens (light + dark)
app.css               layout and components
icons.js              inline SVG icons
utils.js              dates, formatting, quick-add parser, recurrence
store.js              state, local cache, sync engine
firebase-config.js    your Firebase config (empty = local only)
firebase-sync.js      sign-in screen + Firestore connection
push.js               push notifications: permission, device token, Settings → Notifications
records.js            Formwright records: loads the ones you can see, the record picker and chips
firebase-messaging-sw.js  service worker: shows pushes, opens the task when tapped
manifest.webmanifest  install as an app (needed for notifications on iPhone)
*.png                 app icons
toast.js              notifications with Undo
drag.js               drag & drop for mouse and touch
editor.js             task editor
palette.js            command menu
map.js                map data, history, clusters, popovers, Workmap import
map.css               map pages, popovers, sidebar groups and compact rail
list.js               Tasks page
calendar.js           Calendar page
canvas.js             Canvas page (the map as a board)
outline.js            Outline page (the map as a list)
maptable.js           Table page (the map as a table)
insights.js           Insights page (charts)
dashgrid.js           dashboard layout: positions, moving, resizing, turning the old board into a dashboard
charts.js             Chart builder and Dashboards pages
settings.js           Settings page
app.js                app shell, routing, shortcuts
firestore.rules       Firestore security rules (Cadence and Formwright)
storage.rules         Storage security rules (Formwright uploads)
firestore.indexes.json  indexes: reminders, and tasks linked to a record
firebase.json         Firebase CLI config (rules, indexes, functions, hosting)
functions/            Cloud Functions that send the notifications (index.js, package.json, .env)
tests/                rules tests (development only; run with npm test inside tests/)
```

Scripts load in the order listed in `index.html`; keep that order if you add files.

## Storage meter

A Firestore record holds at most 1 MB. Tasks are saved one per record, so they have no such limit, but the map and the Board are each saved as **one** record.

- **Sidebar meter:** shows how full the map is and roughly how many more nodes fit at your current average node size. It adds a Board line once the Board passes 50%. It turns amber at 70% and red at 90%, with words as well as colour.
- **Hiding it:** **×** hides it on this device. **Settings → Map → Storage** shows the full picture and has **Show in sidebar / Hide from sidebar**.
- **When it shows:** only when you're signed in, since the limit applies to synced data.

## Hosting

Cadence is served from Firebase Hosting at its own site (for example `https://cadence-tasks.web.app/`), in the same project as Formwright.

- `.github/workflows/deploy.yml` publishes the web pages on every push to `main`. It needs a `FIREBASE_SERVICE_ACCOUNT` secret (a `tasks-2ae9d` service account key with **Firebase Hosting Admin**) and a `FIREBASE_HOSTING_SITE` variable (the site name, without `.web.app`).
- `firebase.json` names the site `cadence` as a hosting target, and leaves rules, tests, functions and this README off the site.
- `index.html` sends visitors on the old GitHub Pages address to the Firebase address, keeping `?task=`, `?record=` and `?addTaskFor=` links. If you change the site name, change it in that script too.
- Pages and the manifest are served with `no-cache`, so an upload shows up on the next reload.

## Updating the app

**Don't overwrite your `firebase-config.js`.** Update zips from here leave it out, so your filled-in copy on GitHub stays as it is.

`index.html` loads every file with a version tag (`app.js?v=20`). When you change any file, bump the number in `index.html` (and `C.VERSION` in `utils.js`) so browsers fetch the new copies instead of cached ones. Settings → Your data shows the version each device is running.

### Security settings

- **App Check** (optional, recommended): add `window.CADENCE_APPCHECK_KEY = '<reCAPTCHA Enterprise site key>';` to `firebase-config.js`. Cadence then proves to Firebase that requests come from this site. Nothing changes until the key is set.
- **What gets published:** Hosting publishes this folder except tests, functions, rules, docs and any `.json`, `.md`, `.env`, `.pem`, `.key`, `.csv`, `.sql`, `.log` or service-account file, so a key file added by mistake is never served.
- **Headers:** the site can't be framed by other sites, and sends no-sniff, strict referrer and permissions headers.

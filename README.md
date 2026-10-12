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
- **Filters**: narrow any chart by type, importance, map cluster, map branch or person; on the Board, one date range can apply to every chart
- **Treemap and Handoffs**: a treemap sizes boxes by type (or any category) with smaller boxes inside for a second field; Handoffs draws bands from who assigned each task to who's doing it
- **Exploring**: click a legend entry to show only that series (or highlight one slice), and drag across a time chart to zoom into a stretch of dates (swipe sideways on touch screens)
- **Export**: download any chart as a PNG picture or its numbers as a CSV file, from the Chart builder or a Board card's ⋯ menu
- **Canvas heat overlay**: color every node by open tasks, overdue tasks, days late, age, % on time or recent completions, optionally rolled up through each branch
- **Board**: your saved charts on their own page, synced to your account (private to you). Group charts into named sections, make each card small, medium or wide, and reorder them; tap any bar, slice or point to open a list of the tasks behind it, complete them, or open one to edit
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
users/{uid}/items/board      charts saved to your Board (private)
people/{email}               { uid, name }, so others can assign you tasks by email
```

`firestore.rules` makes each task visible only to its owner and its assignee, validates the shape and size of every write, and denies all other paths.

## The map

Canvas, Outline and Table show the same map. It's saved in one private document per account and syncs like your settings. A Firestore document holds up to 1 MB, which is roughly 3,000 nodes; the app warns you as you get close. View state (pan and zoom, folded branches, hidden clusters, table columns) stays on each device.

- **Clusters** are all the nodes that share a color. On map pages the sidebar lists them: click one to select it on the canvas or to filter the outline and table, use the eye to hide it on the canvas, and right-click to recolor the whole cluster. The sidebar collapses to an icon rail (the button next to the logo) to give the canvas more room.
- **Linking tasks.** In the task editor, **On the map** picks a node. Deleting a node doesn't delete its tasks. They stay on your list, and Undo puts the node and the links back. Only tasks you own link to your map; a task someone assigned you points at their map, so it shows no node for you.
- **Moving from Workmap.** In Workmap choose **Export → Download backup (.json)**, then in Cadence open **Settings → Map → Import a Workmap backup** (or use the button on the empty canvas). That replaces the map, and Workmap's tasks become Cadence tasks linked to the same nodes, with their due dates, completion and notes. Importing the same file again won't duplicate tasks. If both apps run on the same domain, Cadence also offers to bring the board in straight from the browser.
- The Workmap board was one board shared by everyone who signed in to it. In Cadence each account has its own map.

## Assigning tasks

In the task editor, **Assigned to** shows "Me", the people you've worked with recently, and an email box. Type someone's email and press **Assign**.

- The person must have signed in to Cadence once. Signing in lists their email in the `people` directory. Directory entries can be looked up one exact email at a time, never listed, and only verified addresses can claim one. Every Google account is verified; email/password users need to verify their address first.
- **The owner** can change anything, reassign, or delete.
- **The assignee** can complete the task, change its date and time, and edit the checklist and notes. Title, type, importance and repeat are read-only for them. They can't delete it, but they can **Hand back** the task to the owner.
- The assignee sees the owner's type and importance names and colors, even if their own settings differ.
- Completing a repeating task as the assignee creates the next occurrence for the same owner and assignee.
- The app shows a notice when someone assigns you a task, and when an assignee completes or hands back one of yours. Use the **Assigned to me** / **Assigned to others** filters on the Tasks page to see just those.
- **Version 16** adds burn-up and flow charts, period comparison, trend lines, chart summaries, chart filters and a Board-wide date range. No rules change.
- **Version 15** adds the sunburst, KPI tiles, goals and the canvas heat overlay. No rules change.
- **Version 14 syncs the Board.** Saved charts used to live in one browser. Now they're saved to your account, private to you, and follow you to every device. The first time each browser opens version 14, its saved charts are added to your account's board (duplicates are skipped). Deploy the new `firestore.rules` first, or the board can't be saved.
- **Version 13 adds the map. Deploy the new `firestore.rules` before uploading the new files**: the old rules reject the map document and any task with a `nodeId`.
- Version 8 moves tasks from the old `users/{uid}/items/{taskId}` location to `tasks/` automatically the first time each person signs in. **Deploy the new rules before uploading the new files**, or the move fails (nothing is lost; the app says so and offers Retry). After the move, the old location no longer accepts task writes, so an outdated open tab gets a sync error until it reloads.

The Firebase web config values are public identifiers, not secrets. Access control comes from the rules. For extra protection against abuse, turn on **App Check** in the console.

If a user had tasks in the browser before signing in for the first time, they are uploaded to that user's new, empty account. A different account signing in on the same browser starts fresh. Signing out clears the local copy.

## Files

All files sit in one folder (no subdirectories), so it uploads to GitHub as-is.

```
index.html
tokens.css            color, type and spacing tokens (light + dark)
app.css               layout and components
icons.js              inline SVG icons
utils.js              dates, formatting, quick-add parser, recurrence
store.js              state, local cache, sync engine
firebase-config.js    your Firebase config (empty = local only)
firebase-sync.js      sign-in screen + Firestore connection
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
charts.js             Chart builder and Board pages
settings.js           Settings page
app.js                app shell, routing, shortcuts
firestore.rules       Firestore security rules
firebase.json         Firebase CLI config (rules + hosting)
```

Scripts load in the order listed in `index.html`; keep that order if you add files.

## Updating the app

**Don't overwrite your `firebase-config.js`.** Update zips from here leave it out, so your filled-in copy on GitHub stays as it is.

`index.html` loads every file with a version tag (`app.js?v=17`). When you change any file, bump the number in `index.html` (and `C.VERSION` in `utils.js`) so browsers fetch the new copies instead of cached ones. Settings → Your data shows the version each device is running.

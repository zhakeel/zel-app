# ZEL — Zone for English Learners

Plain HTML + CSS + JavaScript front end, Firebase (Auth, Firestore, Storage) back end.

## Structure
```
zel-app/
├── index.html        markup only (login, student dashboard, admin panel, modals)
├── css/style.css     all styles; dark + light theme variables at the top
├── js/theme-init.js  runs in <head>, applies saved theme before first paint
├── js/app.js         ES module: Firebase config + all app logic
├── js/ui.js          tab navigation, photo zoom, dark/light toggle
└── firebase.json     Firebase Hosting config
```

## Run locally (must use a server, not double-click)
Browsers block `type="module"` scripts opened from `file://`. Use either:
```
python3 -m http.server 8080        # then open http://localhost:8080
# or
npx firebase-tools emulators:start --only hosting
```

## Deploy
```
npm i -g firebase-tools
firebase login
firebase init hosting     # public dir: .   | single-page app: No | overwrite index.html: No
firebase deploy --only hosting
```
In Firebase Console > Authentication > Settings > Authorized domains, make sure your hosting domain is listed.

## Theme
- Palettes: `:root,html[data-theme="dark"]` and `html[data-theme="light"]` at the top of css/style.css.
- Admin colors are the `--adm-*` variables. Use variables, not hex colors, in new CSS.
- Choice is saved in localStorage key `zel-theme`.

## Rules to keep in mind
- `onclick="..."` in HTML only works for functions assigned to `window` (e.g. `window.doLogout = ...`). Keep that pattern in app.js.
- Keep `js/theme-init.js` as a normal (non-module, non-deferred) script in `<head>`.

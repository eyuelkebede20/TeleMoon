# UI/UX & Interactive Element Quality Checklist

Per `AGENT.md` Section 7.2, every button, input, dialog, and interactive element across mobile and desktop must be audited and verified.

## 1. Authentication Screen (`AuthScreen`)

| Control | Type | Desktop Status | Mobile Status | States Verified |
| --- | --- | --- | --- | --- |
| Theme toggle button | `IconButton` | [x] Passed | [x] Passed | Idle, tap toggles between blue-black & creamy |
| Handle text field | `TextField` | [x] Passed | [x] Passed | Normal, focus border, hint text, '@ ' prefix |
| Password text field | `TextField` | [x] Passed | [x] Passed | Obscured, onSubmitted triggers login |
| Enter button | `ElevatedButton` | [x] Passed | [x] Passed | Idle, loading lockout (spinner), success navigation |
| Server link button | `InkWell` | [x] Passed | [x] Passed | Tap opens `ServerConfigDialog` |
| Error banner | `ErrorBanner` | [x] Passed | [x] Passed | Displays server/auth errors, copy error button, dismiss |

## 2. Link Storage Screen (`LinkStorageScreen`)

| Control | Type | Desktop Status | Mobile Status | States Verified |
| --- | --- | --- | --- | --- |
| Storage link input | `TextField` | [x] Passed | [x] Passed | Handles URL, @username, -100 id, enter submit |
| Channel label input | `TextField` | [x] Passed | [x] Passed | Optional label, enter submit |
| Connect Channel button | `ElevatedButton` | [x] Passed | [x] Passed | Idle, connecting lockout (spinner), error recovery |
| Refresh Channels button | `IconButton` | [x] Passed | [x] Passed | Reloads Telegram dialog list from server |
| Dialog cards | `InkWell` | [x] Passed | [x] Passed | Tap selects channel, active badge, responsive grid |
| Saved channels chips | `ActionChip` | [x] Passed | [x] Passed | Tap connects saved channel, SQLite read/write |
| Sign Out button | `IconButton` | [x] Passed | [x] Passed | Clears token and navigates to `AuthScreen` |
| Theme toggle button | `IconButton` | [x] Passed | [x] Passed | Toggles blue-black & creamy themes |

## 3. Drive Screen (`DriveScreen`)

| Control | Type | Desktop Status | Mobile Status | States Verified |
| --- | --- | --- | --- | --- |
| Back / Switch Storage | `IconButton` | [x] Passed | [x] Passed | Up folder or switch storage channel |
| Theme toggle button | `IconButton` | [x] Passed | [x] Passed | Toggles dark/light seamlessly |
| Refresh drive button | `IconButton` | [x] Passed | [x] Passed | Refreshes current folder contents |
| Sync Settings button | `ElevatedButton` / `IconButton` | [x] Passed | [x] Passed | Opens `SyncDialog` (responsive on mobile) |
| Account Avatar menu | `PopupMenuButton` | [x] Passed | [x] Passed | Switch Storage, Server Settings, Sign Out |
| Breadcrumb navigation | `InkWell` | [x] Passed | [x] Passed | Tap ancestor jumps to folder, scrollable row |
| Track this folder button | `OutlinedButton` | [x] Passed | [x] Passed | Toggles folder tracking, updates sync engine |
| Folder card tap | `InkWell` | [x] Passed | [x] Passed | Navigates into folder |
| File card tap | `InkWell` | [x] Passed | [x] Passed | Shows snackbar with file info |
| Card tracking icon | `IconButton` | [x] Passed | [x] Passed | Toggles item tracking directly |
| Status bar sync indicator | `InkWell` | [x] Passed | [x] Passed | Shows sync status, tap opens `SyncDialog` |

## 4. Sync Settings Dialog (`SyncDialog`)

| Control | Type | Desktop Status | Mobile Status | States Verified |
| --- | --- | --- | --- | --- |
| Close button | `IconButton` | [x] Passed | [x] Passed | Closes dialog |
| Path text field | `TextField` | [x] Passed | [x] Passed | Shows current sync directory path |
| Set Path button | `ElevatedButton` | [x] Passed | [x] Passed | Creates directory and updates sync engine |
| Track All button | `TextButton` | [x] Passed | [x] Passed | Tracks all available items |
| Untrack All button | `TextButton` | [x] Passed | [x] Passed | Untracks all items |
| Item tracking pill | `InkWell` | [x] Passed | [x] Passed | Toggles Tracked / Excluded state |
| Custom path input | `TextField` | [x] Passed | [x] Passed | Allows tracking custom subpath |
| Track custom button | `OutlinedButton` | [x] Passed | [x] Passed | Adds custom tracking path |
| Sync Now button | `ElevatedButton` | [x] Passed | [x] Passed | Triggers immediate sync, shows progress |

## 5. Server Configuration Dialog (`ServerConfigDialog`)

| Control | Type | Desktop Status | Mobile Status | States Verified |
| --- | --- | --- | --- | --- |
| Server URL input | `TextField` | [x] Passed | [x] Passed | Validates URL format |
| Reset Default button | `TextButton` | [x] Passed | [x] Passed | Resets to production backend URL |
| Save & Apply button | `ElevatedButton` | [x] Passed | [x] Passed | Persists custom URL in SharedPreferences |

# Active Calendar Site

Production calendar pages live in `calendar_v10/`.

- Desktop entry: `/calendar_set/calendar_v10/calendar_10.html`
- Mobile entry: `/calendar_set/calendar_v10/calendar_mobile_10.html`
- Shared runtime/cache scripts: `/calendar_set/calendar_v10/calendar-v10-server-cache.js`, `/calendar_set/calendar_v10/server-calendar-sync.js`
- Shared booking/info pages: `/calendar_set/calendar_v10/home_infopage/`

Legacy `calendar_v8/` source files were removed. Legacy `calendar_v8/`, `calendar_v9/`, and `full_ver7/` URLs are redirected to the v10 desktop entry by the production Apache and Netlify redirect rules.
Do not add new UI work outside `calendar_v10/`.

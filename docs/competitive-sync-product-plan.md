# Competitive Naver-SpaceCloud Sync Product Plan

Last reviewed: 2026-07-14 KST

This plan supersedes earlier "one customer = one always-on browser runner" cost
assumptions for the sellable product.

## Hard Constraints

- Naver Reservation and SpaceCloud are mandatory. The product is only valuable if
  it synchronizes those two channels.
- Assume there is no official sync API available.
- Do not build the sellable product around undocumented API polling or token
  extraction.
- Use customer-authorized browser sessions and visible platform screens at a
  human-scale cadence.
- Compete with SPACE UP-like pricing. A default plan must fit about
  29,000 to 39,000 KRW/month.
- Extra features are secondary. SMS, reports, pages, AI, settlement tools, and
  custom booking pages must not drive the product scope.

## Correct Product Definition

The product is:

```text
Naver Reservation <-> SpaceCloud double-booking prevention sync
```

Core actions:

1. Naver confirmed reservation -> block/add matching time in SpaceCloud.
2. Naver cancellation -> remove/restore matching SpaceCloud block.
3. SpaceCloud confirmed reservation -> block matching time in Naver.
4. SpaceCloud cancellation -> restore matching Naver availability.
5. Any conflict, ambiguous match, expired login, or platform error -> alert and
   leave the task reviewable.

## Architecture Shift

Do not keep one full Chrome instance permanently running per customer.

Use this default architecture:

```text
central DB + shared browser runners + customer-specific browser profiles
```

The runner should:

1. Keep one isolated browser profile per customer account.
2. Start or attach to a profile only when scanning or acting.
3. Read visible Naver/SpaceCloud list pages.
4. Create normalized events and sync tasks in DB.
5. Apply only necessary opposite-platform changes.
6. Verify the visible result.
7. Close/release the browser when idle.

This is the only way to approach competitor pricing without using hidden APIs.

## Detection Strategy

Default detection should not require official APIs.

Preferred sellable order:

1. Visible UI feed detection.
   - Naver reservation list sorted by application time.
   - Naver cancellation rows sorted by cancellation time.
   - SpaceCloud reservation list filtered by confirmed/canceled statuses.
2. Email intake as an optional reliability booster.
   - Good for customers willing to forward notification emails.
   - Not required for the base product if visible UI detection is sufficient.
3. iCal/export only as audit/backfill.
   - Do not rely on it for real-time cancellation handling.

## Cadence

Match competitor positioning instead of overengineering:

- Lite: target sync within 5 minutes.
- Managed Sync: target sync within 1 to 3 minutes.
- Premium/Dedicated: target sync around 1 minute.

Do not promise sub-minute behavior unless it is paid and proven.

Use jitter and per-account locks:

- no parallel browser jobs against one customer account;
- no aggressive reload loops;
- back off on login, CAPTCHA, blank page, or repeated platform errors.

## Resource Model

The default commercial model is shared runner capacity.

Example:

```text
8GB runner cost target: about 63,000 KRW/month
5 customers on one runner: about 12,600 KRW/server share each
8 customers on one runner: about 7,900 KRW/server share each
```

Add SMS only if used:

```text
300 to 500 SMS/month: roughly 2,800 to 4,700 KRW at Aligo SMS pricing
```

Target per-customer infrastructure cost:

```text
Lite: under 10,000 KRW/month after scale
Managed Sync: under 15,000 KRW/month after scale
```

If a design requires a dedicated 2GB/4GB VPS for each customer, it is not
competitive for the default plan.

## Customer Login Flow

The customer should not share passwords.

Required product flow:

1. Customer opens a secure onboarding screen.
2. Customer starts a remote browser session for their own isolated profile.
3. Customer logs in to Naver and SpaceCloud manually.
4. The system stores only the browser profile/session state.
5. If the session expires, the system sends a login-needed alert and exposes the
   same remote browser session again.

Implementation options:

- noVNC/browser-in-browser session on the runner;
- remote desktop to a managed runner;
- local customer mini PC only for the lowest-cost/self-hosted plan.

## Pricing Target

The entry plan must compete with SPACE UP Starter-level pricing.

Suggested pricing:

| Plan | Monthly | Setup | Intended architecture |
| --- | ---: | ---: | --- |
| Lite Sync | 29,000 KRW | 99,000 to 149,000 KRW | Shared runner, 5-minute target, one space |
| Managed Sync | 39,000 KRW | 99,000 to 149,000 KRW | Shared runner, 1-3 minute target, stronger monitoring |
| Sync Plus | 59,000 KRW | 99,000 to 199,000 KRW | Higher priority, more rooms/SMS/support |
| Dedicated | 99,000 KRW+ | 149,000 KRW+ | Dedicated runner/VPS or heavy customer |

Space/room expansion:

```text
additional space: 10,000 to 19,000 KRW/month
```

Use competitor pricing as the ceiling for base sync. Charge more only for
managed setup, support, dedicated isolation, or unusually high workload.

## Build Plan

### Phase 1: Prove Shared Runner Mechanics

- Reuse `tools/visible-reservation-feed-test.mjs`.
- Add tenant/profile abstraction.
- Run one customer profile with browser open only during scan/action.
- Measure one full scan cycle:
  - elapsed time;
  - peak RSS;
  - page failures;
  - login-required detection.

Success criteria:

- One customer full scan under 60 seconds.
- Browser can close after scan and reuse the same profile next cycle.
- No platform data is changed during detection scans.

Mac profile reuse test on 2026-07-14:

- Test profile: `state/platform-detect-test/email-free-auth-profile`
- Flow: scan while open -> close Chrome -> reopen same profile -> scan -> close
  Chrome -> reopen same profile -> scan -> close Chrome.
- Result:
  - baseline: `spacecloud_confirmed:5`, `spacecloud_canceled:5`
  - reopen 1: `spacecloud_confirmed:5`, `spacecloud_canceled:5`
  - reopen 2: `spacecloud_confirmed:5`, `spacecloud_canceled:5`
- Conclusion: SpaceCloud session state survived short browser shutdown/reopen
  cycles in the same customer profile.
- Naver result in the same profile was `naver_applications:0` and
  `naver_cancellations:0` because that profile redirected to Naver login. Repeat
  the same profile-reuse test after the customer logs in to Naver in this
  profile.

### Phase 2: Prove Action Worker Without Always-On Chrome

- Queue one Naver -> SpaceCloud action.
- Launch customer profile.
- Apply action through visible UI.
- Verify result.
- Close browser.
- Repeat for SpaceCloud -> Naver action.

Success criteria:

- No always-on browser is needed for idle periods.
- Task can recover after process restart.

### Phase 3: Multi-Tenant Simulation

- Create 5 isolated test profiles.
- Use logged-out profiles for load benchmark first.
- Run sequential scans with a shared runner and strict per-profile locks.
- Measure total cycle time and memory.

Success criteria:

- 5 customer profiles can be scanned within the Lite 5-minute target.
- Peak memory stays within 8GB runner capacity.

### Phase 4: Real VPS Benchmark

- Test on a 4GB runner for one customer.
- Test on an 8GB runner for 5-customer simulation.
- Compare:
  - memory;
  - CPU;
  - failure rate;
  - login flow usability;
  - cost per customer.

### Phase 5: Sellable MVP

MVP scope:

- Naver <-> SpaceCloud sync only.
- One customer, one space, mapped rooms.
- Visible UI detection.
- Visible UI action worker.
- Login-needed alert.
- Conflict/review alert.
- Minimal dashboard: status, last scan, last action, needs-login, needs-review.

Not MVP:

- AI reports;
- custom booking page;
- settlement automation;
- advanced analytics;
- unlimited SMS;
- unrelated channels.

## Key Risk

Without official APIs, the durable competitive advantage is operational quality:

- low-bot-risk cadence;
- robust session/login recovery;
- accurate conflict handling;
- fast support when platform UI changes.

Do not compete by adding unrelated features. Compete by making the two mandatory
channels synchronize reliably and cheaply.

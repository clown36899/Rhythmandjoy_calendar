# VPS Browser Runner Cost And Test

Last reviewed: 2026-07-14 KST

This document records whether the reservation-sync browser runner can move from
a local mini PC to a VPS/virtual environment, and what the rough operating cost
would be.

## Local Virtual Environment Test On Mac

MacBook host:

- macOS 15.6.1 arm64
- RAM: 24GB
- CPU cores: 10
- Docker Desktop available
- Docker VM resources observed by Docker: 10 CPUs, about 8GB RAM

Tests completed:

1. Isolated host Chrome profile:

```bash
open -na "Google Chrome" --args \
  --user-data-dir="$PWD/state/vps-sim-test/chrome-profile" \
  --profile-directory=Default \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9233 \
  --no-first-run \
  --no-default-browser-check \
  about:blank
```

Result:

- Chrome CDP endpoint responded at `http://127.0.0.1:9233/json/version`.
- `tools/visible-reservation-feed-test.mjs` attached successfully.
- Because the profile was not logged in, platform row counts were expectedly `0`.

2. Docker Linux browser runtime:

```bash
docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
docker run --rm -i --ipc=host \
  -v "$PWD/state/vps-sim-test/docker-work:/work" \
  -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  mcr.microsoft.com/playwright:v1.55.0-jammy \
  node -
```

Result:

- Headless Chromium launched inside Linux container.
- A test page loaded successfully.
- The visible-feed detector also ran inside the container by attaching to a
  headless Chromium CDP endpoint.

3. Short-lived profile launch mode:

```bash
node tools/visible-reservation-feed-test.mjs scan \
  --profile-dir state/platform-detect-test/email-free-auth-profile \
  --platform both \
  --limit 5 \
  --work-dir state/platform-detect-test/profile-launch-visible-feed
```

Result:

- Browser opened only for the scan and closed afterward.
- Elapsed time on the Mac host was about 13 seconds.
- The existing SpaceCloud session in the profile was reused:
  `spacecloud_confirmed:5`, `spacecloud_canceled:5`.
- Naver returned 0 rows because that specific test profile was logged out of
  Naver.

4. Docker Linux short-lived headless profile:

```bash
docker run --rm -i --ipc=host \
  -v "$PWD:/repo" \
  -v "$PWD/state/vps-sim-test/docker-work:/work" \
  -w /repo \
  -e NODE_PATH=/work/node_modules \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  mcr.microsoft.com/playwright:v1.55.0-jammy \
  node tools/visible-reservation-feed-test.mjs scan \
    --profile-dir /work/short-lived-profile \
    --platform both \
    --limit 2 \
    --work-dir /work/profile-launch-visible-feed \
    --headless
```

Result:

- Linux container opened a persistent profile, loaded both platforms, wrote a
  snapshot, and closed.
- Elapsed time on the Mac Docker environment was about 9 seconds.
- Feed counts were 0 because this was a new logged-out profile.

5. Local host Chrome memory observation after one feed scan:

```text
Chrome process count: 6
RSS total: about 519MB
```

This was a logged-out lightweight profile. A real logged-in Naver/SpaceCloud
runner should be budgeted more conservatively at about 1.0GB to 1.5GB per active
browser account profile, plus OS and application memory.

## Current Cafe24 VPS Is Too Small

Current Cafe24 server observed on 2026-07-14:

```text
RAM total: 990MB
RAM available: about 205MB
Services already active: MariaDB, Apache, Node server, email importer, calendar cache
```

Conclusion: do not add browser automation to the current Cafe24 VPS.

## Cafe24 Resource Options

Official Cafe24 pages checked on 2026-07-14:

- Cafe24 virtual server hosting:
  `https://hosting.cafe24.com/?controller=new_product_page&page=virtual`
- Cafe24 cloud:
  `https://hosting.cafe24.com/?controller=new_product_page&page=cafe24-cloud`
- Cafe24 developer VPS:
  `https://hosting.cafe24.com/?controller=new_product_page&page=dev-vps`

### Fixed Linux Virtual Server Hosting

Cafe24 virtual server hosting lists these VAT-included prices:

| Plan | RAM | SSD | Traffic | Monthly | Setup |
| --- | ---: | ---: | ---: | ---: | ---: |
| General | 2GB | 50GB | 350GB | 24,750 KRW | 22,000 KRW |
| Business | 3GB | 90GB | 750GB | 39,600 KRW | 22,000 KRW |
| First Class | 4GB | 120GB | 1.2TB | 60,500 KRW | 22,000 KRW |
| Giant | 6GB | 160GB | 1.5TB | 90,750 KRW | 22,000 KRW |

For this browser runner, First Class is the minimum acceptable fixed VPS. Giant
is safer if the same server also handles web/DB/email.

### Cafe24 Cloud

Cafe24 cloud lists hourly VAT-excluded prices. Approximate 30-day VAT-included
costs:

| Plan | CPU | RAM | Hourly VAT excl. | Approx monthly VAT incl. |
| --- | ---: | ---: | ---: | ---: |
| m3.medium | 2 | 4GB | 57 KRW/h | 45,144 KRW |
| m3.large | 4 | 4GB | 78 KRW/h | 61,776 KRW |
| m3.xlarge | 4 | 8GB | 80 KRW/h | 63,360 KRW |
| m3.2xlarge | 8 | 8GB | 108 KRW/h | 85,536 KRW |

For browser automation, `m3.xlarge` is the best current price/performance
candidate because it gives 8GB RAM for almost the same monthly cost as 4GB
fixed VPS.

### Developer VPS

Cafe24 developer VPS lists:

| Plan | CPU | RAM | SSD | Monthly |
| --- | ---: | ---: | ---: | ---: |
| DEV A | 1 | 2GB | 50GB | 33,000 KRW |
| DEV B | 2 | 4GB | 80GB | 66,000 KRW |
| DEV C | 4 | 8GB | 160GB | 132,000 KRW |

This is convenient for Node/Python stacks, but for this specific browser runner
the cloud `m3.xlarge` appears more cost-effective than DEV C.

## Recommended Infrastructure Model

For one Rhythmjoy-like business:

- Minimum: 4GB RAM, 2 vCPU.
- Recommended: 8GB RAM, 4 vCPU.
- Run browser detection/action worker separately from public web/DB when
  possible.
- Keep one Chrome profile per customer account.
- Use 60-second feed scans, not continuous screen polling.
- Stop and alert when login expires.

For a sellable multi-customer product:

- Start with one 8GB runner and cap it at about 2 to 3 active customer browser
  profiles until real production metrics prove otherwise.
- Move heavy DB/web/email workloads to a separate server if customer count grows.
- Do not put many customers into one Chrome process/profile. Use separate
  profiles and DB keys.

## SMS Cost Basis

Official Aligo service material checked on 2026-07-14:

- `https://cdn.aligo.in/smartsms/알리고스마트문자_서비스소개서_문자.pdf`

Listed VAT-excluded unit prices:

| Type | Unit price VAT excl. | Unit price VAT incl. |
| --- | ---: | ---: |
| SMS | 8.4 KRW | 9.24 KRW |
| LMS | 25.9 KRW | 28.49 KRW |
| MMS | 60 KRW | 66 KRW |

The current product design should keep the message short and put details behind
a link so each confirmation uses SMS instead of LMS.

Example at 400 confirmed bookings per month:

```text
400 SMS * 9.24 KRW = about 3,696 KRW/month
```

SMS is not the main cost. Browser runner infrastructure and support time are the
main costs.

## Suggested Pricing

These are operating-price recommendations, not legal/accounting advice.

### Shared Runner Plan

Assumption: one 8GB Cafe24 cloud runner shared by up to 2 or 3 small businesses.

Estimated monthly cost per business:

- VPS share: about 21,000 to 32,000 KRW
- SMS 400/month: about 4,000 KRW
- Monitoring/error buffer: about 10,000 to 20,000 KRW

Suggested price:

```text
59,000 to 79,000 KRW/month
```

Use this only when each customer has one location and a small number of rooms.

### Standard Plan

Assumption: more rooms, more platform actions, more support.

Suggested price:

```text
89,000 to 129,000 KRW/month
```

Include about 500 SMS/month. Extra SMS can be passed through at a rounded rate,
for example 15 KRW/SMS, or absorbed if usage is low.

### Dedicated Runner Plan

Assumption: one customer gets a dedicated 4GB or 8GB runner.

Estimated infrastructure:

- 4GB runner: about 45,000 to 66,000 KRW/month depending on product.
- 8GB runner: about 63,000 to 132,000 KRW/month depending on product.

Suggested price:

```text
149,000 KRW/month and up
```

This is the safer plan for customers who are sensitive to downtime or have many
rooms/accounts.

### Setup Fee

The user preference is to keep setup fees low. Practical setup price:

```text
50,000 to 150,000 KRW one-time
```

This covers:

- customer browser profile setup;
- customer-led Naver/SpaceCloud login;
- Aligo sender registration/API setup;
- initial room mapping;
- first live reservation/cancellation test.

If hardware is required, charge hardware separately or keep the customer on a
VPS runner plan.

## Current Conclusion

The VPS model is feasible if the runner has enough RAM. The current 1GB Cafe24
VPS is not suitable, but a 4GB runner can handle a single light customer and an
8GB runner is the better starting point for a sellable service.

The best next infrastructure test is a real Cafe24 cloud `m3.xlarge` or
equivalent 8GB VPS with:

- Ubuntu 22.04/24.04
- Node.js
- Playwright package
- Chromium/Chrome
- Xvfb or headless Chromium
- noVNC or another customer login path
- one Chrome profile per customer

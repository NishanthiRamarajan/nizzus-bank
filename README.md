# Nizzus Bank portal

A responsive customer banking portal for Nizzus Bank (bank ID `P646`, IFSC `NISH0D6Y3PX`). It connects to the SharedBank Worker for customer authentication, account dashboard data, bank directory and transfers. Nizzus-level applications, portfolio, loans and staff review can use the bank's own Firestore project directly under strict Security Rules; a local HTTPS Function is optional for server-only operations.

## Technology

- React 19 and Vite
- Material UI and Lucide React
- SharedBank Cloudflare Worker APIs
- Firebase Authentication REST API and Firestore Security Rules
- Optional local HTTPS Function for operations that must remain server-only

## Project structure

```text
src/
  config/api-config.js      Environment-based service configuration
  services/http.js          Shared timeout and HTTP error handling
  services/worker-api.js    Central SharedBank Worker client
  services/bank-api.js      Nizzus service/Firestore adapter
  services/auth-service.js  Firebase sign-up, verification and password reset
  services/firestore-api.js Signed-user Firestore REST adapter (no Functions required)
  bank-config.js            Nizzus identity, currency and timezone
  LiveBank.jsx              Customer pages and separate admin interface
  amount.js                 INR-to-paise validation
firestore.rules              Owner/admin rules for bank-level records
```

## Setup

Use Node.js 22 or newer.

```bash
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Set the deployment-specific values in `.env.local` or in the hosting environment. Never commit real credentials.

| Variable | Purpose |
| --- | --- |
| `VITE_X42_API_URL` | SharedBank Worker origin, for example `https://your-worker.example.workers.dev`. If omitted, the current configured Worker origin is used. |
| `VITE_SERVICE_BASE` | Optional full HTTPS base URL for the Nizzus local service Function. Leave blank to use the Firestore REST fallback for bank-level records. |
| `VITE_FIREBASE_API_KEY` | Public Firebase Web API key for the Nizzus Authentication project. It is client configuration, not an authorization secret. |
| `VITE_FIREBASE_PROJECT_ID` | Nizzus Firebase project ID, for operator reference and deployment configuration. |

Firebase Web API keys are visible to browser users by design. Protect data with Firebase Authentication, Firestore rules, HTTPS Functions and server-side authorization. Never add a service account, staff password, Worker signing credential or private key to this frontend.

## Firebase and backend configuration

1. Create a separate Nizzus Firebase project, enable Email/Password Authentication and Firestore, configure authorized domains, and create synthetic test users. Put its project ID in `VITE_FIREBASE_PROJECT_ID`.
2. Register `P646`, IFSC `NISH0D6Y3PX`, Firebase project ID, Web API key and portal origin with the SharedBank operator. The central operator must enable the bank and configure its worker identity/IAM for the Nizzus Firebase project.
3. Add the exact hosted origin to the SharedBank Worker's `FRONTEND_ORIGINS`, then deploy the Worker. Firestore REST uses the customer's Firebase ID token and Firestore Rules; it does not require a Cloud Function or a service-account key in the browser.
4. Review and deploy `firestore.rules` to the Nizzus project. These rules cover only the Nizzus application, positions, loans and partner records. Make sure existing rules do not contain broader overlapping allow rules: Firestore allows a request if any matching rule permits it.
5. Grant trusted staff the `nexusAdmin: true` Firebase custom claim using a trusted admin process. Never create or trust an admin flag from browser data.
6. Seed synthetic accounts through the operator tooling. Approval in Firestore records the review decision; account provisioning remains a separate authorized SharedBank operator action.

The supplied handbook describes the API contracts but does not include Firebase project credentials or a deployed Nizzus local Function. Most bank-level records now use Firestore REST as an alternative, guarded by the supplied Firestore rules. `VITE_SERVICE_BASE` is optional. Operator registration, Worker CORS, Firebase setup and trusted staff claims are still required before live use. Do not expose central operator sign-in or credentials in this portal.

## Development and deployment

```bash
npm run dev
npm run build
npm run preview
```

The Vite production output is written to `dist/`. `.github/workflows/pages.yml` deploys the site through GitHub Pages Actions and copies `.env.example` to `.env.production` before building. Update the public Firebase project ID and Web API key in `.env.example` for deployment; these are client config values, not secrets. `VITE_SERVICE_BASE` can stay blank. Add the deployed origin to the Worker's CORS allowlist and Firebase Authorized domains. If using the optional local Function, add the origin to its CORS allowlist too.

## Integrated API routes

SharedBank Worker (all requests under `/api/v1`):

- `POST /banks/P646/sign-in`
- `GET /banks/P646/dashboard`
- `GET /directory/banks`
- `GET /directory/ifsc/{ifsc}` (directory selection uses active bank records; no destination account-validation endpoint exists)
- `POST /banks/P646/transfers`

Nizzus bank-level Firestore data uses the documented collections directly when `VITE_SERVICE_BASE` is blank. If a local service URL is configured, these documented local Function routes are used instead:

- `GET /me`, `POST /application`
- `PUT` and `DELETE /positions/{id}`
- `PUT /loans/{id}`, `POST /loans/withdraw`
- `GET /admin/queue`, `GET /admin/document/{id}`
- `POST /admin/review`, `POST /admin/limits`, `POST /admin/partners`, `DELETE /admin/partners/{id}`, `POST /admin/loans`

The frontend never writes ledger, account balance, transfer, reservation, daily-usage, inbox or transfer-limit records directly. Balances and transfer status always come from the Worker dashboard; the UI does not locally debit funds or interpret HTTP 202 as settlement.

## Security and operational behavior

- Worker and local requests use bearer authorization, JSON content types, a 15-second timeout and no cookies.
- Customer session tokens live in React memory and are cleared on sign-out. There is no Worker token-refresh route; sign in again after expiry.
- Firebase Authentication REST handles sign-up, email verification and password reset. Application submission requires a verified email claim; after verification, sign out and sign in again.
- Transfer requests use a UUID idempotency key. When a request outcome is uncertain, its exact body and key are retained in tab-scoped session storage for same-request retry. No automatic payment retry occurs.
- File upload is limited to PDF, PNG or JPEG, 256 KiB, and checks the file signature before base64 submission. Admin document downloads create and revoke a temporary object URL.
- Admin pages appear only when the local service's `/me` result or Firestore-mode profile has `admin: true`; the server or Firestore Rules remain authoritative for every admin action.
- In Firestore mode, the `nexusAdmin` signed Firebase custom claim and deployed Firestore Rules are authoritative; the browser-decoded claim only controls whether the UI is shown.

## Known backend limits

- No standalone transaction-history, transfer-status, beneficiary validation, account-list, account-creation, or admin account-picker/current-limits route is documented. History is filtered from the dashboard's returned activity; account IDs for limit updates must be entered manually.
- The directory lists active banks, not destination accounts. A destination is validated by the transfer backend at settlement.
- Transfer defaults in the handbook are ₹5,000 per transfer and ₹7,000 daily; custom limits may differ and are enforced by the backend. Available funds and limits can change before settlement.
- Manual-review transfers need bank/operator support with the transfer ID. Approval of a loan records a decision only; it does not disburse funds.
- Local partner records are contacts only; they do not register a participant in central routing.
- Firestore mode can create and review applications, manage holdings and loan requests, and maintain local partner contacts without Cloud Functions. Firebase email verification and Firestore Rules must be configured.
- Firestore mode cannot edit `transfer_limits` because those remain server-managed. The admin form is only enabled when the local service Function is configured.
- Approving an application does not provision an account in Firestore mode. An authorized operator must seed the account through the SharedBank operator tooling. No account, balance, ledger or transfer record is written by the browser.
- Firestore mode does not send review emails; email delivery requires the optional server-side service/extension.
- This repo does not contain Firebase credentials or synthetic test account credentials. Live auth and transfer settlement require the configured SharedBank Worker. Bank-level Firestore features require the Nizzus Firebase project and deployed rules. Account provisioning and transfer-limit changes remain trusted operator/server work.

## Validation

`npm run build` validates the production bundle. End-to-end integration checks must use synthetic Firebase users, synthetic accounts and synthetic documents against deployed or emulator backends; never use real customer banking or KYC data.

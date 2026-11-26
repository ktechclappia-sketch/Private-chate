# Privacy Chat Development Report

Updated: 2026-11-26

## Scope and source

Repository: [ktechclappia-sketch/Private-chate](https://github.com/ktechclappia-sketch/Private-chate)  
Development branch: [privacy-chat-full-development](https://github.com/ktechclappia-sketch/Private-chate/tree/privacy-chat-full-development)  
Supabase project: KTech IT Hub (`plwpjflifvndejidiwqa`)

Code changes remain on the development branch; `main` is untouched. GitHub Pages now publishes from `privacy-chat-full-development/docs`. No unrelated project schema or paid plan was changed.

## Implemented on the development branch

- Added the client portal at `docs/client.html`, `docs/client.css`, and `docs/client.js`. It includes profile, subscription dates, ₹100 monthly renewal, UPI payment reference submission, payment history/status, registered devices, APK workflow link, support, and logout.
- Linked the client portal from the existing admin page at `docs/index.html`.
- Added authenticated device registry and device RPCs in `backend/privacy_chat_devices_rls.sql`; Android root app records this device on sign-in through `DeviceRegistry.java`.
- Added five-second polling for new messages in the active Android chat thread in `MainActivity.java`.
- Disabled the obsolete WebView app's mismatched Supabase configuration in `Privacy_Chat_Android_Studio/app/src/main/assets/config.js` so it cannot accidentally call the Vitthala project.
- Added `.github/workflows/android-artifacts.yml` to build Android APK and AAB artifacts from the development branch.
- Added a database trigger that timestamps a payment when an admin approves or rejects it, so collection reporting uses review time.
- Added `backend/privacy_chat_access_controls.sql` to source-control the currently deployed `enabled` / `free_testing` access flags and the matching chat/admin RPCs. The previous checked-in base SQL did not contain these deployed access-control fields, which could make a fresh restore incomplete.

## Supabase changes and security review

Applied migrations to the specified KTech IT Hub project:

- `privacy_chat_device_registry_and_private_rls`
- `privacy_chat_device_rpc_execute_grants`
- `privacy_payment_review_timestamp`

Read-only schema checks confirmed RLS is enabled on the six `privacy_chat` tables and there are no direct table grants to `anon` or `authenticated`. Access is intended through authenticated RPCs that enforce the caller's identity and permissions. Public subscription and payment rows retain their existing user-scoped policies. The payment review timestamp trigger was applied.

The Security Advisor still reports:

- An informational “RLS enabled without policy” item on the six RPC-only tables. Direct table grants are absent; clients must use the approved RPCs.
- Leaked Password Protection is disabled. I did not find an available project-auth settings operation in the connected tools, so this remains for account-level configuration.

No service-role key was added to client code. The client portal uses the project's publishable key. Android session data continues to use the existing encrypted session vault; client web sessions are memory-only.

## Build evidence

GitHub Actions run [45820351229](https://github.com/ktechclappia-sketch/Private-chate/actions/runs/45820351229) completed successfully on commit `1591211bf383f2e20e149b4a4d7ab0cb2c81d855`. It produced artifact `Privacy-Chat-Android-Artifacts` (artifact ID `15117412124`), available until 2026-12-26. It is downloadable from that run's Artifacts section.

The APK is a debug-signed sideload build. The generated release AAB is unsigned and is not ready for Play Console upload. A private Android release signing key and protected CI secrets are needed before making a Play-ready AAB. No signing secret was committed.

## Deployment status

- GitHub Pages source was changed on 2026-11-26 to the `privacy-chat-full-development` branch and `/docs` folder; the protected `main` branch was not modified.
- Pages build and deployment run [45839106150](https://github.com/ktechclappia-sketch/Private-chate/actions/runs/45839106150) completed successfully.
- The live Admin sign-in page was verified at [https://ktechclappia-sketch.github.io/Private-chate/](https://ktechclappia-sketch.github.io/Private-chate/).
- The live Client sign-in page was verified at [https://ktechclappia-sketch.github.io/Private-chate/client.html](https://ktechclappia-sketch.github.io/Private-chate/client.html).
- These checks verified page loading and sign-in forms only; authenticated dashboard actions were not tested.

## Final user testing checklist

Status for every item below: **Not run**. The user requested final user testing after development is complete.

- [ ] Email sign-in, auto-login, sign-out, and re-login
- [ ] Password A opens the full chat; Password B opens the empty dashboard
- [ ] Automatic lock and screenshot protection on a real Android device
- [ ] Personal messages synchronize between two accounts
- [ ] Friend request accept/reject
- [ ] Group creation, photo sharing, and member removal
- [ ] Client portal profile, subscription dates, ₹100 renewal, UPI reference, and payment history
- [ ] Admin payment approval/rejection and live client status update
- [ ] Admin activate/deactivate and free testing access
- [ ] Monthly collection/report and payment history
- [ ] Expiry and renewal behavior
- [ ] Device list on multiple Android devices
- [ ] Cross-user data access denial with separate test accounts
- [ ] Install and exercise the APK on a physical Android device
- [ ] Verify Client portal authenticated flows through the deployed URL

## Backup status

A scoped data snapshot was captured on 2026-11-26 and saved as `Privacy_Chat_DB_Backup_2026-11-26.json`. It contains only the Privacy Chat private-schema tables plus `public.privacy_subscriptions` and `public.privacy_payments`; no Accounting, KTech License, Hotel, or Trading data was exported. Snapshot counts: people 5, rooms 1, memberships 2, messages 0, devices 0, admin allowlist rows 2, subscriptions 2, payments 3. This is a data snapshot, not a full PostgreSQL physical backup or a verified restore rehearsal.

## Pending issues

1. Android release AAB needs private release signing configuration; current AAB is unsigned.
2. User-level app, payment, and authenticated dashboard flow testing remains pending.
3. Leaked Password Protection needs to be enabled in Supabase Auth settings.
4. A scoped user-data snapshot exists, but a full PostgreSQL restore rehearsal still needs a database credential/export path that is not available through the connected tools.
5. The existing chat photo transport is not end-to-end encrypted; do not describe it as such.
6. The checked-in migration source is now closer to the deployed schema, but the full Supabase migration history still contains older cross-project migrations for accounting and licensing. Do not replay the complete history into a new project without separating those concerns.

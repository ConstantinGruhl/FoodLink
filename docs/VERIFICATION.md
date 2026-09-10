# Docker acceptance checks

Target: a complete local Docker application, with no external deployment. This checklist records the acceptance scope; execution results are recorded in the implementation summary after verification.

Final result on 9 September 2026: **72 automated tests passed**, both clean container builds passed, all five local services were healthy, and database/image restore drills passed. See [the implementation summary](IMPLEMENTATION_SUMMARY.md) for measured results and the limits of the checks, including external integrations and physical-camera testing.

## Application journeys

| Journey | Acceptance condition |
|---|---|
| Account registration | New donor/buyer/recipient can register; staff roles cannot be self-assigned; email verification works through the local mail service |
| Account recovery | Recovery response does not reveal account existence; token expires and cannot be reused; reset invalidates old sessions |
| Recipient approval | Pending recipients see a clear state; only administrators can approve eligibility; API enforces it |
| Donation | Donor creates and edits an offer; its quantity is unavailable until staff receipt; cancellation is permitted only in the allowed state |
| Images | Valid small images upload and render; malformed/oversized files and cross-owner requests fail; offered images remain private |
| Reservation | One basket becomes one order; fresh sessions and reloads preserve ticket/history; invalid baskets do not change stock |
| Pickup | Staff redeems a protected token once; history and impact update; repeat redemption does not distribute stock twice |
| Cancellation | Cancellation restores eligible inventory exactly once; completed orders cannot be cancelled |
| Delivery | Delivery requires an address, event permission, assigned volunteer and completion proof; unrelated volunteers cannot complete it |
| Marketplace | Received surplus has correct prices and units; cart supports quantity changes; unavailable payments are clearly disabled |
| Optional payments | Checkout uses configured provider; signatures, amount/currency, event replay and cancellation are checked; no redirect alone marks an order paid |
| Operations | Staff can manage future events, inventory/disposal, deliveries and period reports independently of earlier page navigation |
| Administration | Staff onboarding, eligibility, account disablement and role changes are authorized and audited; last admin remains protected |
| Impact and reports | Totals derive from completed distribution and known weights; donation receipts preserve original received quantities |
| Profile and privacy | User can update profile, change password, export data and deactivate account; retained history is explained |
| Accessibility | Phone navigation, associated input labels, keyboard forms, pending/error/empty states and recoverable pages work |

## Data and security checks

- Separate sessions for each role; unauthorized and cross-user reads/writes rejected.
- Cookie/CSRF/origin behavior, session invalidation, generic recovery responses and rate limits.
- Two simultaneous reservations for the last unit: only one succeeds.
- Identical idempotency key and basket returns the original order; changed payload with the same key fails.
- Failed multi-item baskets roll back entirely; positive integer quantity and currency limits enforced.
- Original donation quantities and order snapshots survive inventory mutations.
- Expired food and closed/cancelled events cannot receive new reservations.
- Backup, restore and migration checks use separate test databases; existing development data remains intact.

## Container checks

- Clean dependency installation, TypeScript/build, automated tests and dependency audit.
- All default services start with healthchecks; application uses loopback-only development ports.
- Fresh database migration/seed and legacy database upgrade both succeed without destructive reset.
- Restart retains data; readiness detects unavailable required dependencies.
- Backup restores into a distinct database with row counts and key relationships preserved.
- Production-oriented configuration fails clearly for missing secrets and does not enable demo accounts.
- Local mail/storage provide testable integrations without provider accounts.

Live provider transactions, external SMTP delivery and a hosted release are outside this Docker-only acceptance target. Their integration configuration must be explicit; no local simulation may be represented as a real payment or delivery to an external mailbox.

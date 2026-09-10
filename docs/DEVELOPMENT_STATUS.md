# Development checkpoint

This branch contains the completed first Docker prototype together with **unfinished multi-charity implementation work**, published as a work-in-progress checkpoint at the owner's request.

The earlier [implementation report](IMPLEMENTATION_SUMMARY.md) describes verification of the first prototype. Those results do not establish that the current multi-charity changes are complete or runnable.

## Current check

The backend TypeScript check fails because `app.ts` imports the not-yet-created `organizations.ts` module, and `orders.ts` still references `isStaff` and `assertOwner` during the authorization refactor. The current checkpoint has not passed a fresh container build or end-to-end verification. Do not treat it as a release.

## Resume here

- Complete charity/location management and staff invitation endpoints using the [foundation contract](V2_FOUNDATION_CONTRACT.md).
- Finish scoped authorization across orders, inventory, storage, administration, reports and background operations.
- Integrate the distribution/entitlement routes and finish the remaining inventory, import, transfer and sales workflows.
- Complete the frontend workflows against the backend contracts.
- Back up existing data before applying the new migrations; verify clean installation and upgrade behavior.
- Run builds, automated acceptance checks and browser journeys with multiple charities and locations.

The intended scope and milestones are recorded in the [product evolution proposal](PRODUCT_EVOLUTION_PROPOSAL.md). Delivery remains Docker containers, without public deployment.

Local environment files, database backups and generated dependencies are excluded from Git. Their removal from the tracked tree does not remove files from earlier Git history.

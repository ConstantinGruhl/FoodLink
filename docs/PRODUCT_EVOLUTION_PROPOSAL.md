# FoodLink: charities, locations and daily food allocation

Prepared 9 September 2026. This is a product and development proposal, not an implementation report. The user confirmed that FoodLink should support **several independent charities, each with its own locations**. Delivery remains local Docker containers; public deployment is outside the current scope.

The preferred distribution style is still an open choice. The recommendation below makes booking a visit and choosing food on site the initial default while also supporting prepared packages and online item reservations.

## 1. Product direction

FoodLink should help each charity answer four practical questions: What food is coming? Where is it needed? What can we distribute today? What should happen to the remaining food?

The core journey is:

**Need or available donation → agreed destination → physical receiving → allocation to distribution, transfer or sale → collection → reconciliation.**

The application should offer short, role-specific screens for this work. Detailed records support those screens in the background. Volunteers should not need to operate a warehouse administration system to hand out a food package.

## 2. Organizations, locations and people

| Level              | Responsibility                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform           | Onboard charities and maintain the service. Routine platform operation should not require access to recipient case information.                               |
| Charity            | Own its policies, locations, staff memberships, recipient eligibility decisions, reports and any sales proceeds.                                              |
| Location           | Have a stable identity, address, contact, timezone, opening hours, receiving windows, collection instructions, storage capabilities and active/paused status. |
| Storage area       | Optionally distinguish a warehouse, refrigerator, freezer or distribution room within a location.                                                             |
| Distribution event | A dated session at a location, with its own capacity, booking rules, allocation and completion record.                                                        |

One account can hold several memberships: for example, a volunteer at two locations and a donor elsewhere. A donor can support several charities without creating separate logins. Eligibility and household records belong to each charity; one charity must not see another charity's applications, reasons for eligibility or household history.

| Role             | Proposed powers                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Charity manager  | Manage all of that charity's locations, appoint managers, set eligibility and allowance policies, approve sale policies, oversee transfers and reports.                                            |
| Location manager | Operate assigned locations, invite volunteers, schedule events, publish needs, pause donation categories, receive and adjust stock, approve event closeout, and price goods within charity policy. |
| Volunteer        | Perform assigned receiving, counting, picking, check-in or delivery duties. No default ability to appoint managers, change eligibility policy or set prices.                                       |
| Donor            | Offer food, choose destinations, import lists and follow receipt history for their own donations.                                                                                                  |
| Recipient        | Select an eligible location, book a visit or reserve food, and see remaining allowance and collection instructions.                                                                                |
| Buyer            | Browse available surplus, see the selling charity and location, purchase and collect.                                                                                                              |

Inviting a volunteer should send an expiring activation link. Existing users gain a location membership; managers do not choose or share their passwords. A location manager can remove their location's access without disabling an account used by another charity. Charity-wide policies define what location managers may override.

## 3. Donating should start with a suitable destination

A location page should show **Needed now**, **Currently accepting**, **Temporarily paused**, opening/drop-off times, and whether collection from the donor is available. Donors can search by town or postal code without enabling device location.

The normal flow is: choose a location → describe the food → choose delivery/drop-off or request collection → receive confirmation → see what was actually received. Returning donors can repeat a previous offer and update quantities and dates.

For large donations, a donor may select “Help me find a suitable destination.” Start with transparent suggestions based on stated needs, storage capability, receiving time, travel distance and remaining shelf life. Explain the match. The donor and receiving charity confirm any changed destination; the system should not silently redirect food.

A single donor submission can be split into separate destination consignments. Each consignment needs its own acceptance, quantities, arrival time and receipt history. Food belongs to one physical location at a time.

At receiving, volunteers must be able to accept part of an offer, record the actual quantity and condition, and reject lines with a reason. “Offered 20 boxes, received 17, rejected 3” must remain visible without overwriting the original offer. A quick receiving flow should also handle unscheduled arrivals.

## 4. Acceptance rules and requests for food

Use a shared food-category vocabulary with charity-specific policy and location-specific availability. A rule can mean allowed, approval required, temporarily paused, or prohibited, with an effective period and an explanation.

Examples: “No bread until Monday: storage full”; “Chilled dairy only by prior arrangement”; “Up to 10 crates of apples this afternoon.” Rules may depend on the donor type, storage needs and remaining usable time. Tafel Deutschland, for example, distinguishes donations from private people and businesses when describing acceptance of chilled and frozen food. This supports configurable rules rather than one universal category switch. [Tafel donation guidance](https://www.tafel.de/spenden/lebensmittel-spenden/?L=0).

Changing a rule should flag existing accepted offers for review, rather than silently cancelling promises. Staff can handle an operational exception with a reason where charity policy permits it; a temporary capacity exception must not override a food-safety restriction.

A published request should contain a category/product, quantity and unit, deadline, destination, acceptable substitutions and receiving instructions. For example: “North location needs 40 litres of long-life milk before Friday.” Track **requested, promised and received** separately. Donor cancellations and unreceived promises should reopen the outstanding need. Public information need not reveal recipient identities or internal stock details.

## 5. Useful inventory with manageable data entry

Separate the reusable food definition from the physical batch. “Rice” is a food type. “24 bags of 500 g rice received Tuesday at North” is a batch with its own source, dates, quantity, storage and permitted uses.

Record units and pack sizes explicitly. A box is not equivalent to a piece or kilogram. Support estimated weights, but label their precision. An unknown allergen status must remain unknown rather than appearing as allergen-free.

Distinguish on-hand food from quantities allocated to an event, reserved online, held for a buyer, in transfer, held for inspection, or available for a new commitment. The same units cannot back two commitments. Keep a dated movement history for receipt, allocation, collection, transfer, disposal and stock correction.

Use the earliest suitable handling deadline first when suggesting batches. Preserve both the date label type and the operator's assessed distribution deadline. EU guidance distinguishes safety-related “use by” dates from quality-related “best before” dates; treating them as one generic expiry field would cause inappropriate decisions. [European Commission date-marking guidance](https://food.ec.europa.eu/food-safety/food-waste/eu-actions-against-food-waste/date-marking-and-food-waste-prevention_en), [food-redistribution guidance](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52020XC0612%2808%29).

Managers need a quarantine/recall action that removes affected stock from new commitments and identifies relevant batches, transfers and recorded collections. For distributions without item-level handout records, the system must show that individual exposure is unknown.

Transfers within a charity require request/acceptance, dispatch and destination receipt, including quantity differences. In-transit food is unavailable at both ends. Transfers between charities should be an explicit later workflow with permission from both parties, ownership history and no automatic recipient-data sharing.

## 6. Distribution events should support different operating styles

Keep donor collection drives separate from recipient distribution events. Within a distribution event, distinguish **what a person books** from **how food is handed out**.

| Event style                          | Recipient experience                                                                  | Staff work                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Online item reservation              | Choose available products and a collection time; see confirmed quantities.            | Prepare recorded orders and confirm collection.                                                      |
| Visit booking with on-site choice    | Book a time and see broad availability; choose food when arriving.                    | Check in the household and apply the event's allowance. Item contents are not guaranteed in advance. |
| Visit booking with prepared packages | Book a suitable package/visit for the household; state optional dietary requirements. | Assemble and hand out packages, allowing practical substitutions.                                    |

Make on-site choice possible even when advance product selection is disabled. Research conducted by NORC for Feeding America found benefits associated with offering choice, including satisfaction and reduced reported food waste. That supports preserving choice where the charity can offer it; it does not establish one universal model for every location. [NORC evaluation](https://www.norc.org/research/projects/feeding-americas-child-family-choice-program.html).

Events need time slots, household capacity, a booking cutoff, walk-in capacity, optional waitlists, staff assignments and clear pickup instructions. Capacity should reflect how many households staff can serve; available food is a separate constraint. Do not let multiple orders from the same household consume multiple attendance places unless explicitly allowed.

Support phone/in-person bookings entered by staff, printable collection references and manual lookup. An email address, smartphone or QR code should not be required for assisted food collection. Walk-ins must be entered into the same attendance and allowance process so they are not invisible to capacity planning.

## 7. Leftovers-only entry must be a supported, honest workflow

The user specifically requested events where recipients cannot choose food in advance and leftovers can be entered afterward. This should be a normal event mode, not a workaround involving fake product orders.

Offer two recording options:

1. **Opening quantities known:** record or allocate opening stock, additional receipts, transfers and losses. After counting leftovers, calculate a reconciled distribution quantity and have staff resolve discrepancies. For example, 50 crates at opening + 10 received − 12 left − 3 spoiled = 45 crates distributed, provided there were no other movements. Do not silently classify an unexplained shortage as food distributed.
2. **Only leftovers counted:** allow attendance and receipt/provenance notes during the event without detailed item counts. At closeout, record the physical leftovers with their condition, dates and source information. Attendance and closing stock are known; the amount distributed is unknown unless separately measured or explicitly estimated.

Detailed intake quantities may be deferred in the second option, but essential source and food-handling information should still be captured. If a batch was already in inventory, allocate it to the event and reconcile it; do not create duplicate stock from its leftovers.

Stock allocated to the event is excluded from online reservations and sales while the event is active. Closing the scheduled time does not prove that food remains. The closeout flow is: stop admissions → record attendance → count remaining food and losses → resolve differences → confirm available leftovers → choose retain, transfer, distribute again or sell.

Changing the clock or running the closeout twice must not create or release stock twice. Automatic surplus publication may follow a confirmed closeout; it must never substitute for that count.

## 8. Recipient allowances should be understandable and fair

Start with charity-configurable **household visit limits**, then add category or package limits where useful. Example policy for discussion: one collection per household per week across a charity's locations, with additional quantities based on household size and local availability. These numbers are examples, not an established charity standard.

One household can have more than one authorized collector. Charity staff approve the household size used for allowances; a profile change should request review rather than instantly increase entitlement. Each charity controls its own eligibility and allowance period. Do not silently impose a platform-wide limit across independent charities.

An active booking holds the relevant visit allowance. Item reservations also hold item/category allowance. Collection consumes it; cancellation releases it; expiry/no-shows follow an explicit, visible grace policy. Avoid automatic punitive bans. Managers need recorded exceptions for emergencies and corrections.

For events without recorded item handouts, the software can enforce visit/package limits. It cannot truthfully enforce or report exact per-category consumption unless staff record those quantities. If precise category enforcement is required, add a short tally at handout.

Recipients should see plain explanations such as “Your household has one visit remaining this week” and “This slot is full; these two locations have availability.” Buying surplus must not automatically consume charitable-food allowance or change eligibility.

## 9. Surplus sales need an explicit allocation policy

Public retail sales, a small contribution for charitable food, and an optional donation are different transactions. Tafel Deutschland's principles describe distribution to people experiencing poverty for free or a small cost contribution. That is a reason to make public surplus sales an organization-specific option rather than assume every charity operates a public shop. [Tafel principles](https://www.tafel.de/ueber-uns/unsere-werte/tafel-grundsaetze).

Enable public sales separately for each charity. Record whether a donated batch may be sold or transferred, based on the donor agreement and charity policy. Unknown permission means not eligible for automatic sale. A charity can protect food for future aid distributions before releasing a surplus quantity.

Allow location managers, within charity policy, to set a fixed unit price, a defined package price, and approved category defaults. Display exactly what the buyer receives, the seller, pickup location/time, allergens/unknowns and total payable price. Confirmed order prices remain unchanged when a manager edits future prices.

Provide three publication settings: manual only, suggest for manager approval, or automatic under approved rules. Begin with manual/suggested publication. An example automatic rule is: “After this event's closeout is confirmed, publish counted, permitted leftovers above the protected aid quantity at the approved price, with a collection deadline before the handling deadline.”

Before publication or checkout, recheck stock, source restrictions, inspection status, protected allocations, deadlines, price and whether the policy is still enabled. Show why a listing exists and provide a pause control. Do not change the price of an active payment commitment or sell food already promised to a recipient.

Keep one checkout per selling charity and pickup location in the first version. Multi-charity baskets would add separate sellers, pickups, refunds and settlement. Each charity needs an explicit payment destination and access to its own sales/refunds; the existing single global payment configuration is not sufficient for that model. Provider integration can be simulated locally until external payment setup is separately requested.

## 10. Excel import is worthwhile, especially for repeat business donors

Accept CSV and XLSX through a downloadable template and a mapping/preview screen. Suggested columns: donor reference, destination code, food/product, category, quantity, unit, pack size/weight, date-label type, date, storage, allergens, arrival window and relevant source restrictions.

The flow should be: upload → map columns → validate and flag duplicates → review destination groups and errors → confirm draft offers. Show clear row errors for unknown locations, ambiguous dates, incompatible units and missing information. Preserve product identifiers as text. Never execute spreadsheet formulas or macros.

An import creates proposed donations, not received inventory. Only authorized receipt confirmation changes usable stock. Repeated uploads must not duplicate the same consignment. Save a donor's mapping for future files. Provide a copy-and-paste table as a lighter alternative for small lists.

Also support separate, permission-controlled import flows for staff stock counts and event leftovers. Those imports need an event/location, a preview of resulting changes and duplicate protection. They must never share a generic “upload spreadsheet to overwrite inventory” action.

## 11. Dashboards should prioritize today's decisions

| Audience         | Most useful first screen                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location manager | Incoming donations, upcoming visits, unreceived offers, urgent food, category shortages, acceptance pauses, unresolved closeouts and surplus awaiting a decision.            |
| Charity manager  | Locations needing stock or staff, useful transfer opportunities, distributions completed, food losses and reasons, unresolved issues, and sales/refunds separately from aid. |
| Volunteer        | Today's assigned location and duties, quick receive, household check-in, package handout and stock count.                                                                    |
| Donor            | Where this food is needed, repeat last donation, upcoming arrangements and received quantities.                                                                              |
| Recipient        | Eligible locations, next available visit, clear allowance, booking/ticket and collection instructions.                                                                       |
| Buyer            | Available food near the chosen location, clear prices/contents, pickup times and order status.                                                                               |

Prioritize alerts that lead to an action over decorative charts. Reports should separate food received, distributed, transferred, sold and discarded, and distinguish measured quantities from estimates. Moving a batch between locations is not another donation or another rescued kilogram.

## 12. What the prototype already supplies, and the development order

The current application has useful foundations: authentication, donation offers and receipt history, a stock ledger, item reservations, event capacity, pickup/delivery, manual surplus prices, payment/refund handling, email delivery and Docker verification. Keep these foundations and expand the model.

The inspected implementation has one organization configuration, global staff roles and shared stock; `events.location` is address text rather than a location record. Volunteers currently have broad receiving, event and pricing rights. Recipient limits are a single account/event quantity cap, with household size not used. Receipt accepts all offered quantities, and events require item-based orders. There are no organization memberships, location stock boundaries, demand campaigns, transfers, configurable household entitlements or event leftovers closeout.

Relevant starting points: [inventory operations](../backend/src/inventory.ts), [events and orders](../backend/src/orders.ts), [staff administration](../backend/src/operations.ts), [authorization](../backend/src/security.ts), [frontend contracts](../frontend/src/lib/schemas.ts), and [completed baseline](IMPLEMENTATION_SUMMARY.md).

| Milestone                          | Deliverable                                                                                                                                                      | Acceptance example                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Charity and location foundation | Organizations, locations, memberships, scoped permissions, volunteer invitations and migration of current data into one default charity/location.                | A manager of Charity A cannot read, modify, export or access photos belonging to Charity B, including by changing an identifier. A location manager cannot appoint a charity manager. |
| 2. Food intake and location stock  | Structured categories/batches, destination selection, partial receiving, date/condition handling, acceptance rules, needs, donor imports and internal transfers. | An imported offer affects available stock only after receipt; dispatch/receipt cannot make transferred stock available at both locations.                                             |
| 3. Everyday distribution           | Household enrollment/allowances, visit and item booking, on-site/prepared-package modes, assisted booking, check-in and counted or leftovers-only closeout.      | Two simultaneous bookings at different locations cannot exceed one charity's household allowance; uncounted opening stock never generates exact distribution totals.                  |
| 4. Controlled surplus commerce     | Protected aid quantities, source permissions, scoped pricing, per-charity seller configuration, manual/suggested release and then optional automation.           | An event ending without confirmed leftovers releases nothing; a sale cannot consume food already reserved for aid.                                                                    |
| 5. Operational refinement          | Action dashboards, recurring donor arrangements/events, better matching, demand trends, report exports and realistic staff/recipient walkthroughs.               | A volunteer can complete the typical receive → check-in → closeout shift with a short, consistent set of screens.                                                                     |

Operational screens and basic dashboard counts should arrive alongside their workflows, not wait until the final milestone. The last milestone improves them using observed use. Add cross-charity transfer agreements, route optimization, predictive demand, offline synchronization and multi-seller checkout only after the underlying flows are validated.

Keep the current application and Docker structure; this proposal does not require microservices. Add organization/location constraints to records and enforce access in server queries and relationships, including reports, images, exports, background jobs and payment callbacks. Existing stock and order history should migrate without inventing missing locations or quantities beyond an explicitly labelled default assignment.

Test with two separate demo charities and several locations, deliberately different managers and policies, simultaneous reservations/transfers, duplicate imports, partial receipts, a no-choice event with unknown opening stock, and an automatic-sale event that has not been reconciled. External deployment remains outside this plan.

## 13. Choices to settle through a small operator walkthrough

Confirmed: several charities, each with locations. Remaining choices are which event style to optimize first; the initial household allowance policy; which charities permit public sales and under what donor terms; how precisely volunteers can count incoming mixed food; and whether most donors drop off food or require collection.

Walk through a morning delivery, a busy distribution session and an end-of-day surplus decision with a charity manager, a receiving volunteer and recipients before locking these defaults. Source material informs the proposal, but the examples and workflow recommendations above are design judgments to validate with the intended operators.

# Roles and permission matrix

Authorisation is enforced in the API (never only in the UI):

- Global `AuthGuard`: deny-by-default; `@Public()` routes opt out; `@Staff(roles…)` requires a staff
  role **and** an MFA-verified session.
- Object-level checks: `AccessService.requireMerchant(auth, merchantId, minRole)` and
  `requireOperator(auth, marketId, role)` return **404** for non-members, and every query is
  additionally scoped by the resolved `merchantId`/`marketId`/`customerId` (tested in Scenario D).

## Principals

| Principal                                         | How granted                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Guest                                             | no session; may browse, keep a cart, check out with email+phone, track via order token |
| Customer                                          | any registered user                                                                    |
| Merchant OWNER / MANAGER / STAFF                  | `merchant_members` (owner on registration; others by invitation)                       |
| Market operator MARKET_ADMIN / MARKET_EDITOR      | `market_operator_members`, assigned by KDCN ops                                        |
| KDCN SUPER_ADMIN / OPERATIONS / FINANCE / SUPPORT | `users.staffRoles`, assigned by a super-admin; MFA mandatory                           |

## Matrix (✓ allowed, — denied, ◐ restricted)

| Capability                                                       | Guest     | Customer | M-Staff | M-Manager | M-Owner | Op-Editor | Op-Admin | Ops              | Finance  | Support           | Super |
| ---------------------------------------------------------------- | --------- | -------- | ------- | --------- | ------- | --------- | -------- | ---------------- | -------- | ----------------- | ----- |
| Browse, search, storefronts                                      | ✓         | ✓        | ✓       | ✓         | ✓       | ✓         | ✓        | ✓                | ✓        | ✓                 | ✓     |
| Cart & checkout                                                  | ✓ (guest) | ✓        | ✓       | ✓         | ✓       | ✓         | ✓        | ✓                | ✓        | ✓                 | ✓     |
| View/cancel/dispute own orders                                   | token     | ✓        |         |           |         |           |          |                  |          |                   |       |
| Review completed own orders                                      | —         | ✓        |         |           |         |           |          |                  |          |                   |       |
| Manage products & inventory                                      |           |          | ✓       | ✓         | ✓       |           |          |                  |          |                   |       |
| Confirm/fulfil orders                                            |           |          | ✓       | ✓         | ✓       |           |          | ◐ courier orders |          |                   | ✓     |
| Cancel paid order with refund                                    |           |          | —       | ✓         | ✓       |           |          | ✓                |          | ✓                 | ✓     |
| Store profile, locations, fulfilment options                     |           |          | —       | ✓         | ✓       |           |          |                  |          |                   |       |
| Payout details, staff invitations, verification submission       |           |          | —       | —         | ✓       |           |          |                  |          |                   |       |
| View settlements & analytics                                     |           |          | —       | ✓         | ✓       |           |          |                  | ✓        |                   | ✓     |
| Respond to reviews                                               |           |          | —       | ✓         | ✓       |           |          |                  |          |                   |       |
| Market page, announcements                                       |           |          |         |           |         | ✓         | ✓        |                  |          |                   |       |
| Approve affiliations, collection points                          |           |          |         |           |         | —         | ✓        | ✓                |          |                   | ✓     |
| Market aggregate metrics (no customer/merchant financial detail) |           |          |         |           |         | ✓         | ✓        |                  |          |                   |       |
| Merchant verification decisions, suspension                      |           |          |         |           |         |           |          | ✓                |          |                   | ✓     |
| View verification documents & private addresses (audited)        |           |          |         |           |         |           |          | ✓                |          |                   | ✓     |
| Product moderation, listing blocks                               |           |          |         |           |         |           |          | ✓                |          | ◐ reports/reviews | ✓     |
| Order oversight                                                  |           |          |         |           |         |           |          | ✓                | ✓ (read) | ✓                 | ✓     |
| Disputes: message, assign                                        |           |          |         |           |         |           |          | ✓                |          | ✓                 | ✓     |
| Disputes: resolve (incl. refunds)                                |           |          |         |           |         |           |          | —                | —        | ✓                 | ✓     |
| Request goodwill refund                                          |           |          |         |           |         |           |          |                  | ✓        | ✓                 | ✓     |
| Approve/reject/retry refunds                                     |           |          |         |           |         |           |          |                  | ✓        | —                 | ✓     |
| Payment reconciliation, webhook log, settlements payout          |           |          |         |           |         |           |          |                  | ✓        |                   | ✓     |
| Commission configuration, settlement mode                        |           |          |         |           |         |           |          |                  | ✓        |                   | ✓     |
| Manual dispatch / fulfilment monitoring                          |           |          |         |           |         |           |          | ✓                |          |                   | ✓     |
| Users, staff roles, jobs                                         |           |          |         |           |         |           |          |                  |          | ◐ suspend users   | ✓     |
| Audit log                                                        |           |          |         |           |         |           |          | ✓                | ✓        |                   | ✓     |

Market operators never receive customer identities, merchant payout details, private addresses or
per-merchant financials. Merchants see customer name/phone/address only after an order is paid.

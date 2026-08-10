/**
 * The two CONTRACT MISMATCH compensations, tested rather than asserted in prose.
 *
 *   npm test
 *
 * `accountsAdapter.ts` is the only place Stage 4 works around Stage 3's
 * contract, and CM-2 and CM-3 are both pure data reshaping — which means they
 * can be tested for real instead of being taken on trust. CM-1 (`myProfile`)
 * needs a live client and is covered by the on-device pass instead; it is named
 * BLOCKED in `.pipeline/04-frontend-accounts.md` rather than faked here.
 *
 * The fixture is the shape `listMyMemberships()` actually returns once sql/012
 * is applied: `memberships_select_member` is `using (is_member(company_id))`, so
 * a member reads **every** membership row of their company, not only their own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { membershipIds, mine } from './accountsAdapter.ts';

const ME = 'user-me';
const MATE = 'user-mate';
const BOSS = 'user-boss';

const company = (id, name) => ({
  id, name, city: null, region: null, created_by: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});

const NORTHSIDE = company('co-north', 'Northside Mechanical');
const HARBOUR = company('co-harbour', 'Harbour HVAC');

/** Three people in Northside, and I am also solo-owner of Harbour. */
const ROWS = [
  { id: 'm1', company_id: 'co-north', user_id: BOSS, role: 'owner', created_at: '2026-08-01T00:00:00Z', company: NORTHSIDE },
  { id: 'm2', company_id: 'co-north', user_id: ME, role: 'member', created_at: '2026-08-02T00:00:00Z', company: NORTHSIDE },
  { id: 'm3', company_id: 'co-north', user_id: MATE, role: 'member', created_at: '2026-08-03T00:00:00Z', company: NORTHSIDE },
  { id: 'm4', company_id: 'co-harbour', user_id: ME, role: 'owner', created_at: '2026-08-04T00:00:00Z', company: HARBOUR },
];

test('CM-2: my company list is one row per company, not one per co-member', () => {
  // Without this filter a three-person shop appears three times in the list and
  // the switcher offers the same company over and over. The API returns the
  // co-members' rows because the policy permits it — correctly — so the screen
  // has to narrow, and this is where.
  const rows = mine(ROWS, ME);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.company_id).sort(), ['co-harbour', 'co-north']);
  assert.deepEqual(rows.map((r) => r.role).sort(), ['member', 'owner']);
});

test('CM-2: the filter is disambiguation, not isolation', () => {
  // Stated as a test so the intent survives a refactor: passing a *different*
  // user id still returns rows, because RLS — not this function — is what
  // decided the caller could see them at all. If this were security, the anon
  // key shipping in the bundle would already have defeated it.
  assert.equal(mine(ROWS, BOSS).length, 1);
  assert.equal(mine(ROWS, 'nobody').length, 0);
});

test('CM-2: a solo technician gets an empty list, which is the normal case', () => {
  assert.deepEqual(mine([], ME), []);
});

test('CM-3: membership ids are recoverable per company, keyed by user', () => {
  // `public.company_roster` cannot supply these — OQ-A1 keeps the view down to
  // what a company may see about a person — but setMemberRole/removeMembership
  // are keyed by them. Without this, an owner cannot act on the roster at all.
  assert.deepEqual(membershipIds(ROWS, 'co-north'), {
    [BOSS]: 'm1',
    [ME]: 'm2',
    [MATE]: 'm3',
  });
});

test('CM-3: ids never leak across companies', () => {
  const harbour = membershipIds(ROWS, 'co-harbour');
  assert.deepEqual(harbour, { [ME]: 'm4' });
  assert.equal(harbour[MATE], undefined);
});

test('CM-3: an unresolvable company yields no ids, so no controls are drawn', () => {
  // The screen renders a roster row with no management controls rather than a
  // button that cannot work. Empty here must stay empty rather than throwing.
  assert.deepEqual(membershipIds(ROWS, 'co-nonexistent'), {});
  assert.deepEqual(membershipIds([], 'co-north'), {});
});

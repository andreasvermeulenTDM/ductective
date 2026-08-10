/**
 * ST-A06 — the guest route writes nothing. Ever.
 *
 *   npm test
 *
 * AC 1 calls this "the defining criterion" of the story, and it belongs at the
 * seam rather than in a screen: a screen test would prove one screen behaves,
 * where this proves the *only* module that can write, does not.
 *
 * The spy client counts `from()` calls. It is injected through the store's test
 * hook rather than by monkey-patching the module, because this repo has no
 * mocking framework and is not adding one.
 *
 * Plain `.mjs` so `node --test` discovers it. The module under test is
 * TypeScript; Node strips its types on import.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  __setClientForTests,
  answerExisting,
  askQuestion,
  createSession,
  deleteSession,
  generateReply,
  guestTranscriptLength,
  isPersistingStore,
  listSessions,
  loadMessages,
  resetGuestState,
  setStoreAuth,
} from './store.ts';

/**
 * Records every table the store touches. If the guest route ever regains a
 * database call, `spy.tables` stops being empty and this file goes red.
 */
function spyClient() {
  const spy = { tables: [], rpcs: [] };
  const chain = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined; // not a thenable
        return () => chain;
      },
    }
  );
  return {
    spy,
    client: {
      from(table) {
        spy.tables.push(table);
        return chain;
      },
      rpc(name) {
        spy.rpcs.push(name);
        return chain;
      },
    },
  };
}

beforeEach(() => {
  resetGuestState();
  setStoreAuth(false);
  __setClientForTests(null);
});

test('the store defaults to guest — forgetting to set auth loses data, never leaks it', () => {
  assert.equal(isPersistingStore(), false);
});

test('AC 1: a full guest conversation issues zero Supabase calls', async () => {
  const { spy, client } = spyClient();
  __setClientForTests(client);
  setStoreAuth(false);

  const session = await createSession('high head pressure', 'Trane Precedent YSC072');
  await askQuestion(session.id, 0, 'high head pressure on a Precedent');
  await answerExisting(session.id, 1, 'high head pressure on a Precedent', 'Trane Precedent YSC072');
  // The retry path — a question already in state whose reply never arrived.
  await answerExisting(session.id, 1, 'high head pressure on a Precedent', 'Trane Precedent YSC072');
  await loadMessages(session.id);
  await listSessions();
  await deleteSession(session.id);

  assert.deepEqual(spy.tables, [], `guest route touched: ${spy.tables.join(', ')}`);
  assert.deepEqual(spy.rpcs, []);
});

test('AC 1: the session id is synthetic and obviously not a database row', async () => {
  const session = await createSession('bad capacitor');
  assert.match(session.id, /^guest-session-/);
  assert.equal(session.company_id, null);
});

test('AC 3: a guest answer carries citations in exactly the signed-in shape', async () => {
  const session = await createSession('high head pressure');
  await askQuestion(session.id, 0, 'high head pressure');
  const reply = await answerExisting(session.id, 1, 'high head pressure');

  assert.ok(reply.kind, 'the reply must carry a kind — the rendering contract');
  assert.ok(Array.isArray(reply.citations));
  for (const c of reply.citations ?? []) {
    assert.equal(typeof c.source_document, 'string');
    assert.ok(c.source_document.length > 0, 'a citation with no source document is an uncited claim');
    assert.equal(typeof c.page, 'number');
    assert.ok(c.page > 0);
    assert.equal(typeof c.id, 'string');
  }
});

test('AC 4: nothing on the answer path is conditioned on auth state', async () => {
  // The same input, generated through the same function, on both sides of the
  // seam. `generateReply` takes no identity argument at all — that is the
  // structural half of ST-A19 AC 4, and this is the behavioural half.
  setStoreAuth(false);
  const asGuest = await generateReply('gas valve will not open');
  setStoreAuth(true);
  const asUser = await generateReply('gas valve will not open');
  setStoreAuth(false);

  assert.equal(asGuest.kind, asUser.kind, 'a refusal for one is a refusal for the other');
  assert.equal(asGuest.body, asUser.body);
  assert.equal(asGuest.citations.length, asUser.citations.length);
});

test('AC 8: a retry replaces the turn rather than duplicating it', async () => {
  const session = await createSession('condenser fan');
  await askQuestion(session.id, 0, 'condenser fan will not start');
  await answerExisting(session.id, 1, 'condenser fan will not start');
  await answerExisting(session.id, 1, 'condenser fan will not start');

  const messages = await loadMessages(session.id);
  assert.equal(messages.length, 2, 'the retry must not append a second reply');
  assert.deepEqual(messages.map((m) => m.seq), [0, 1]);
});

test('OQ-A4 sub-decision 1: the History tab gets an empty list, not the guest transcript', async () => {
  const session = await createSession('economizer');
  await askQuestion(session.id, 0, 'economizer stuck open');
  assert.equal(guestTranscriptLength(), 1);
  assert.deepEqual(await listSessions(), []);
});

test('AC 10: signing out clears the transcript', async () => {
  const session = await createSession('low suction');
  await askQuestion(session.id, 0, 'low suction pressure');
  assert.equal(guestTranscriptLength(), 1);

  resetGuestState();
  assert.equal(guestTranscriptLength(), 0);
  assert.deepEqual(await loadMessages(session.id), []);
});

test('AC 8: nothing is back-filled when the store flips to persisting', async () => {
  const { spy, client } = spyClient();
  __setClientForTests(client);

  const session = await createSession('reversing valve');
  await askQuestion(session.id, 0, 'reversing valve chatter');
  assert.equal(spy.tables.length, 0);

  // The transition itself must not write. The next question creates a real
  // session; the earlier turns stay on screen and stay unsaved.
  setStoreAuth(true);
  assert.deepEqual(spy.tables, [], 'signing in must not back-fill the guest transcript');
  assert.equal(guestTranscriptLength(), 1, 'the visible transcript is retained, not destroyed');
});

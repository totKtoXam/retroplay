import assert from 'node:assert/strict';

const base = process.env.RETRO_TEST_URL || 'http://localhost:3000';

async function actor() {
  const r = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const data = await r.json();
  return { cookie, id: data.id };
}

async function req(a, path, body) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: a.cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
}

console.log('Testing Room Visibility and Access Management integration flows against', base);

const host = await actor();
const guest1 = await actor();
const guest2 = await actor();

// 1. Create Public Room
const pubRes = await req(host, '/api/rooms', {
  title: 'Public Team Retro',
  name: 'Host Alice',
  theme: 'nauryz',
  access: 'public',
  maxPlayers: 8,
});
assert.equal(pubRes.status, 201, JSON.stringify(pubRes.data));
const pubId = pubRes.data.id;
console.log('✔ Public room created:', pubId);

// Verify Public Room appears in browse=public
const browseRes = await req(guest1, '/api/rooms?browse=public');
assert.equal(browseRes.status, 200);
assert.ok(Array.isArray(browseRes.data.rooms));
const foundPublic = browseRes.data.rooms.find((r) => r.id === pubId);
assert.ok(foundPublic, 'Public room must be visible in browse=public');
assert.equal(foundPublic.title, 'Public Team Retro');
assert.equal(foundPublic.hostName, 'Host Alice');
assert.equal(foundPublic.accessType, 'public');
assert.equal(foundPublic.status, 'available');
assert.equal(foundPublic.maxPlayers, 8);
console.log('✔ Public room listed in browse=public');

// Guest 1 can join public room directly without approval
const pubJoin = await req(guest1, `/api/rooms/${pubId}`, {
  type: 'join',
  name: 'Bob Free',
});
assert.equal(pubJoin.status, 200, JSON.stringify(pubJoin.data));
console.log('✔ Guest 1 joined public room freely');

// 2. Create Private Room
const privRes = await req(host, '/api/rooms', {
  title: 'Confidential Strategy Retro',
  name: 'Host Alice',
  theme: 'steppe',
  access: 'private',
  maxPlayers: 2,
});
assert.equal(privRes.status, 201, JSON.stringify(privRes.data));
const privId = privRes.data.id;
console.log('✔ Private room created:', privId);

// Verify Private Room NEVER appears in browse=public
const browseAfterPriv = await req(guest1, '/api/rooms?browse=public');
const foundPriv = browseAfterPriv.data.rooms.find((r) => r.id === privId);
assert.equal(foundPriv, undefined, 'Private room must NEVER appear in public browse list');
console.log('✔ Private room is hidden from browse=public');

// Host can view room and its private invite token
const hostPrivView = await req(host, `/api/rooms/${privId}`);
assert.equal(hostPrivView.status, 200);
const inviteToken = hostPrivView.data.state.access.inviteToken;
assert.ok(inviteToken && inviteToken.length >= 16, 'Host must have inviteToken');
console.log('✔ Host retrieved private room invite token');

// Guest 2 tries GET without invite token -> 404
const noTokenGet = await req(guest2, `/api/rooms/${privId}`);
assert.equal(noTokenGet.status, 404, 'Must return 404 when querying private room without token');
console.log('✔ Querying private room without token returns 404');

// Guest 2 tries GET with invalid invite token -> 404
const badTokenGet = await req(guest2, `/api/rooms/${privId}?invite=invalid-fake-token-12345`);
assert.equal(badTokenGet.status, 404, 'Must return 404 when querying private room with invalid token');
console.log('✔ Querying private room with invalid token returns 404');

// Guest 2 tries direct POST type: join without approval -> 403
const unapprovedJoin = await req(guest2, `/api/rooms/${privId}`, {
  type: 'join',
  name: 'Intruder Charlie',
});
assert.equal(unapprovedJoin.status, 403, 'Must return 403 when joining private room without host approval');
console.log('✔ Direct join on private room without approval returns 403');

// Guest 2 GET with valid invite token -> 200, isPrivate = true, requestStatus = 'none'
const validGet = await req(guest2, `/api/rooms/${privId}?invite=${inviteToken}`);
assert.equal(validGet.status, 200);
assert.equal(validGet.data.join, true);
assert.equal(validGet.data.isPrivate, true);
assert.equal(validGet.data.requestStatus, 'none');
console.log('✔ Guest 2 queries room with valid invite token: requestStatus = none');

// Guest 2 creates join request
const sendReq = await req(guest2, `/api/rooms/${privId}`, {
  type: 'join_request.create',
  name: 'Charlie Applicant',
  inviteToken: inviteToken,
});
assert.equal(sendReq.status, 200);
assert.equal(sendReq.data.ok, true);
assert.equal(sendReq.data.status, 'pending');
const reqId = sendReq.data.id;
assert.ok(reqId);
console.log('✔ Guest 2 created join request in pending status');

// Guest 2 re-sends request -> returns same pending request without error
const dupReq = await req(guest2, `/api/rooms/${privId}`, {
  type: 'join_request.create',
  name: 'Charlie Applicant',
  inviteToken: inviteToken,
});
assert.equal(dupReq.status, 200);
assert.equal(dupReq.data.id, reqId);
assert.equal(dupReq.data.status, 'pending');
console.log('✔ Duplicate join request returns existing pending request without creating duplicates');

// Host views room and sees pending join request
const hostCheckRequests = await req(host, `/api/rooms/${privId}`);
assert.equal(hostCheckRequests.status, 200);
assert.ok(Array.isArray(hostCheckRequests.data.joinRequests));
const pendingInHost = hostCheckRequests.data.joinRequests.find((r) => r.id === reqId);
assert.ok(pendingInHost, 'Host must receive pending joinRequests');
assert.equal(pendingInHost.name, 'Charlie Applicant');
console.log('✔ Host sees pending join request in joinRequests list');

// Host rejects request
const rejectRes = await req(host, `/api/rooms/${privId}`, {
  type: 'join_request.reject',
  id: reqId,
});
assert.equal(rejectRes.status, 200);
console.log('✔ Host rejected join request');

// Guest 2 status check now shows rejected
const statusCheck1 = await req(guest2, `/api/rooms/${privId}?invite=${inviteToken}`);
assert.equal(statusCheck1.data.requestStatus, 'rejected');
console.log('✔ Guest 2 status updated to rejected');

// Guest 2 submits new join request
const newReq = await req(guest2, `/api/rooms/${privId}`, {
  type: 'join_request.create',
  name: 'Charlie Applicant 2',
  inviteToken: inviteToken,
});
assert.equal(newReq.status, 200);
assert.equal(newReq.data.status, 'pending');
const newReqId = newReq.data.id;
assert.notEqual(newReqId, reqId);
console.log('✔ Guest 2 submitted new request after rejection');

// Non-host cannot accept request
const nonHostAccept = await req(guest1, `/api/rooms/${privId}`, {
  type: 'join_request.accept',
  id: newReqId,
});
assert.equal(nonHostAccept.status, 400);
console.log('✔ Non-host cannot accept join requests');

// Host accepts new request
const acceptRes = await req(host, `/api/rooms/${privId}`, {
  type: 'join_request.accept',
  id: newReqId,
});
assert.equal(acceptRes.status, 200);
console.log('✔ Host accepted join request');

// Guest 2 status check shows accepted
const statusCheck2 = await req(guest2, `/api/rooms/${privId}?invite=${inviteToken}`);
assert.equal(statusCheck2.data.requestStatus, 'accepted');
console.log('✔ Guest 2 status updated to accepted');

// Guest 2 joins room
const chJoin = await req(guest2, `/api/rooms/${privId}`, {
  type: 'join',
  name: 'Charlie Applicant 2',
});
assert.equal(chJoin.status, 200);
console.log('✔ Guest 2 successfully joined private room after host approval');

// Verify room members count is now 2 (host + Charlie)
const hostRoomAfterJoin = await req(host, `/api/rooms/${privId}`);
assert.equal(hostRoomAfterJoin.data.members.length, 2);
console.log('✔ Private room members count verified (2/2)');

// 3. Capacity limit enforcement (maxPlayers = 2)
const extraGuest = await actor();
const fullJoin = await req(extraGuest, `/api/rooms/${privId}`, {
  type: 'join_request.create',
  name: 'Extra Dave',
  inviteToken: inviteToken,
});
assert.equal(fullJoin.status, 400);
assert.ok(fullJoin.data.error.includes('заполнена'));
console.log('✔ Room capacity enforcement verified (cannot request when full)');

// 4. Host regenerates invite token
const regenRes = await req(host, `/api/rooms/${privId}`, {
  type: 'access.regenerate_invite',
});
assert.equal(regenRes.status, 200);
const newInviteToken = regenRes.data.state.access.inviteToken;
assert.notEqual(newInviteToken, inviteToken);
console.log('✔ Host regenerated invite token');

// Old token now returns 404
const oldTokenCheck = await req(extraGuest, `/api/rooms/${privId}?invite=${inviteToken}`);
assert.equal(oldTokenCheck.status, 404, 'Old token must return 404 after regeneration');
console.log('✔ Old invite token returns 404 after regeneration');

// New token works
const newGuestActor = await actor();
const newTokenCheck = await req(newGuestActor, `/api/rooms/${privId}?invite=${newInviteToken}`);
assert.equal(newTokenCheck.status, 200);
console.log('✔ New invite token works correctly');

console.log('\nAll Room Access and Visibility integration tests passed successfully!');

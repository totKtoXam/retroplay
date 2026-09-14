import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../lib/weapon-definition.ts';
import { ToolMagazine } from '../lib/tool-magazine.ts';
import { memberFromRow, fireEffect, newMatch, roomFromState } from '../lib/room-hub-core.ts';
import { controlWeapon, memberWeapon, weaponReply } from '../lib/weapon-authority.ts';
import { WeaponPrediction } from '../lib/weapon-prediction.ts';
const T = 100000;
function fixture() {
  const member = memberFromRow({session:'a', hp:100, immune_until:0, pose:JSON.stringify({x:0,y:0,z:4,yaw:0,stance:'stand'})});
  const room=roomFromState('a',{});
  const hub={room,members:new Map([['a',member]]),effects:[],seq:0,match:newMatch(room,T)};
  return {member,hub};
}
const shot = (kind='paint',over={}) => ({id:crypto.randomUUID(),kind,life:0,color:'#ff647c',origin:[0,1,4],target:[0,1,0],normal:[0,0,1],...over});
for (const [tool,def] of Object.entries(WEAPONS)) test(`${tool}: client and authority agree at cadence boundary`,()=>{
  const {hub}=fixture(), client=new ToolMagazine();
  for(const delta of [0,def.cooldown-1,def.cooldown,def.cooldown*2])
    assert.equal(fireEffect(hub,'a',shot(tool),T+delta).ok,client.fire(tool,T+delta));
});
test('authority exhausts a magazine, enforces reload time, and never spends a duplicate',()=>{
  const {hub,member}=fixture();
  const first=shot();
  assert.equal(fireEffect(hub,'a',first,T).ok,true);
  assert.equal(fireEffect(hub,'a',first,T+180).ok,false);
  for(let i=1;i<24;i++)assert.equal(fireEffect(hub,'a',shot(),T+i*180).ok,true);
  const emptyAt=T+24*180;
  assert.equal(fireEffect(hub,'a',shot(),emptyAt).ok,false);
  assert.equal(memberWeapon(member).magazine.rounds.paint,0);
  assert.equal(fireEffect(hub,'a',shot(),emptyAt+1449).ok,false);
  assert.equal(fireEffect(hub,'a',shot(),emptyAt+1450).ok,true);
  assert.equal(memberWeapon(member).magazine.rounds.paint,23);
});
test('explicit reload, cancellation, stale life and new life loadout are authoritative',()=>{
  const {hub,member}=fixture();fireEffect(hub,'a',shot(),T);
  controlWeapon(member,{id:'r',action:'reload',tool:'paint',life:0},T+200);
  assert.equal(fireEffect(hub,'a',shot(),T+400).ok,false);
  controlWeapon(member,{id:'c',action:'cancel',life:0},T+500);
  assert.equal(fireEffect(hub,'a',shot(),T+600).ok,true);
  assert.equal(memberWeapon(member).magazine.rounds.paint,22);
  member.life=1;
  assert.equal(fireEffect(hub,'a',shot(),T+2000).reason,'stale-life');
  const sync=controlWeapon(member,{id:'s',action:'sync',life:1},T+2000);
  assert.equal(sync.magazine.rounds.paint,24);
  assert.equal(sync.life,1);
});
test('prediction refunds a rejected shot and reapplies newer input once',()=>{
  const {member}=fixture(),p=new WeaponPrediction();p.reset(0);
  p.magazine.fire('paint',0);p.remember('rejected','fire','paint',0);
  p.magazine.fire('paint',180);p.remember('next','fire','paint',180);
  p.acknowledge(weaponReply(member,'rejected',T,false,'immune'),200);
  assert.equal(p.magazine.rounds.paint,23);
  memberWeapon(member).magazine.fire('paint',T+180);
  const later=weaponReply(member,'next',T+180,true);
  p.acknowledge(later,220);
  assert.equal(p.magazine.rounds.paint,23);
  p.acknowledge({...later,id:'rejected',revision:0},230);
  assert.equal(p.magazine.rounds.paint,23,'old acknowledgements cannot refund newer input');
});

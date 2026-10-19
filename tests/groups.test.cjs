const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../core/store.cjs');
const {initialReward}=require('../core/model.cjs');
const {RewardGroups}=require('../core/groups.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reward-groups-')),store=new Store(root),calls=[];
 const a=store.putReward({...initialReward(),remoteId:'remote-a',account:'ours',clientId:'client',sync:'pending',cost:350,cooldown:120});
 const b=store.putReward(initialReward('video'));
 const twitch={assertOwner:r=>{if(r.account!=='ours')throw Error('Other account');},request:async(...args)=>{calls.push(args);return {};}};
 const groups=new RewardGroups(store,twitch);
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,store,a,b,calls,groups,twitch};
}
test('groups change only color, preserve drafts, media and pending Twitch settings',async t=>{
 const f=fixture(t);
 f.store.stashDraft({...f.a,prompt:'Unpublished draft'});
 const group=await f.groups.save({name:'Music',color:'#123456',members:[f.a.id,f.b.id]});
 assert.equal(group.errors.length,0);
 assert.deepEqual(f.calls,[['PATCH','channel_points/custom_rewards',{id:'remote-a'},{background_color:'#123456'}]]);
 assert.deepEqual(f.store.reward(f.a.id),{...f.a,background:'#123456'});
 assert.equal(f.store.meta('editor:'+f.a.id).value.prompt,'Unpublished draft');
 assert.equal(f.store.meta('editor:'+f.a.id).value.background,'#123456');
 assert.equal(f.store.reward(f.b.id).remoteId,'');
 assert.ok(f.store.versions(f.a.id).length);
 f.groups.remove(group.id);
 assert.equal(f.store.rewards().length,2);
 assert.equal(f.store.reward(f.a.id).background,'#123456');
});
test('group moves membership without duplicates and validates before writes',async t=>{
 const f=fixture(t),one=await f.groups.save({name:'One',color:'#112233',members:[f.b.id]});
 await f.groups.save({name:'Two',color:'#445566',members:[f.b.id,f.b.id]});
 assert.deepEqual(f.groups.list().find(g=>g.id===one.id).members,[]);
 const before=JSON.stringify(f.groups.list());
 await assert.rejects(f.groups.save({name:'Bad',color:'#000000',members:['missing']}));
 assert.equal(JSON.stringify(f.groups.list()),before);
});
test('partial Twitch failure is reported per reward and retry changes color only',async t=>{
 const f=fixture(t);f.twitch.request=async()=>{throw Error('Offline');};
 const group=await f.groups.save({name:'One',color:'#123456',members:[f.a.id,f.b.id]});
 assert.equal(group.errors.length,1);assert.equal(group.errors[0].id,f.a.id);
 f.twitch.request=async(...args)=>f.calls.push(args);
 const retry=await f.groups.save(group);
 assert.equal(retry.errors.length,0);
 assert.deepEqual(f.calls[0][3],{background_color:'#123456'});
});
test('foreign account is never patched and group survives reopening database',async t=>{
 const f=fixture(t);f.store.putReward({...f.a,account:'other'});
 const group=await f.groups.save({name:'One',color:'#123456',members:[f.a.id]});
 assert.equal(group.errors.length,1);assert.equal(f.calls.length,0);
 const reopened=new Store(f.root);
 assert.deepEqual(new RewardGroups(reopened,f.twitch).list(),f.groups.list());reopened.close();
});

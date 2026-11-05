const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HashBinStore, HashBinDocuments: Docs } = require('../src/fragment-config.mjs');
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
function cid(text){const size=Buffer.alloc(6);size.writeUIntBE(Buffer.byteLength(text),0,6);return size.toString('base64url')+(text.length<=64?Buffer.from(text):Buffer.alloc(64,1)).toString('base64url')}
function fullCID(text){const data=Buffer.from(text),size=Buffer.alloc(6);size.writeUIntBE(data.length,0,6);return size.toString('base64url')+(data.length<=64?data:require('node:crypto').createHash('sha512').update(data).digest()).toString('base64url')}
test('saves go through HashBin Publish with the pinned SDK and verify the returned CID',async()=>{
 const snapshot={src:'from audio import *',files:{},settings:{sampleRate:44100}},payload=Docs.serialize(snapshot);let options;
 const store=new HashBinStore({clientId:'test',loadSDK:async()=>({HashBinClient:class{publish(content,opts){assert.equal(content,payload);options=opts;return Promise.resolve({cid:fullCID(payload)})}}})});
 await assert.rejects(store.publish(payload,snapshot),/still loading/);await store.init();
 assert.equal((await store.publish(payload,snapshot)).cid,fullCID(payload));assert.deepEqual(options,{contentType:'application/json',fileName:'scene.json',clientState:{snapshot}});
 store.client.publish=async()=>({cid:fullCID(payload+' ')});await assert.rejects(store.publish(payload,snapshot),/does not match its CID/);
 await assert.rejects(new HashBinStore({clientId:''}).init(),/registered client ID/);
 assert.match(require('node:fs').readFileSync('vendor/fragment-kit-v0.3.3/src/hashbin/store.js','utf8'),/hashbin-sdk-v0\.4\.0/);
});
test('redirect saves restore source and files after approval or cancellation; legacy tokens are revoked',async()=>{
 const transactionStorage=storage(),snapshot={src:'from audio import *',files:{},settings:{sampleRate:44100}},payload=Docs.serialize(snapshot);let outcome='approve';
 const store=new HashBinStore({clientId:'test',transactionStorage,loadSDK:async()=>({HashBinClient:class{publish(){return Promise.resolve({redirected:true})}async handlePublishCallback(){if(outcome!=='approve')throw Object.assign(new Error('access_denied'),{clientState:{snapshot}});return {cid:fullCID(payload),clientState:{snapshot}}}}})});
 await store.init();assert.equal(await store.published('#'+cid('plot x')),null);
 await store.publish(payload,snapshot);assert.deepEqual(await store.published('#hashbin_publish=s&cid=x'),{cid:fullCID(payload),snapshot});
 await store.publish(payload,snapshot);outcome='cancel';assert.deepEqual(await store.published('#hashbin_publish=s&error=access_denied'),{error:'The save was cancelled on HashBin.',snapshot});
 const local=storage();let revoked=0,loaded=0;const legacy=new HashBinStore({clientId:'test',legacyStorage:local,loadSDK:async()=>{loaded++;return {HashBinClient:class{async disconnect(){revoked++;local.removeItem('hashbin:tokens:test')}}}}});
 assert.equal(await legacy.retireLegacyTokens(),false);assert.equal(loaded,0);local.setItem('hashbin:tokens:test','{"refreshToken":"old"}');assert.equal(await legacy.retireLegacyTokens(),true);assert.equal(revoked,1);
});
test('remote loads verify bytes against the CID',async()=>{
 const text=Docs.serialize({src:'from audio import *'+' '.repeat(80),files:{},settings:{}}),served=body=>new HashBinStore({fetchSource:async()=>({ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode(body).buffer})});
 assert.match((await served(text).load(fullCID(text))).src,/^from audio/);
 await assert.rejects(served(text.replace('audio import','Audio import')).load(fullCID(text)),/does not match its CID/);
});
test('network loads validate size and UTF-8, time out, and report not-found errors',async()=>{
 const remote=cid('x'.repeat(200));
 const missing=new HashBinStore({fetchSource:async()=>({ok:false,status:404})});await assert.rejects(missing.load(remote),/not found/);
 const timeout=new HashBinStore({timeout:5,fetchSource:()=>new Promise(()=>{})});await assert.rejects(timeout.load(remote),/timed out/);
 const bad=Buffer.from([0xc3,0x28]);const prefix=Buffer.alloc(6);prefix.writeUIntBE(2,0,6);await assert.rejects(new HashBinStore().load(prefix.toString('base64url')+bad.toString('base64url')),/encoded data/);
});
test('vendored SDK files are the exact v0.4.0 release, and the CSP pins its sandbox bootstrap',()=>{
 // Hashes from https://hashbin.org/sdk/v0.4.0/integrity.json.
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const sri=file=>'sha384-'+crypto.createHash('sha384').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('base64');
 assert.equal(sri('vendor/fragment-kit-v0.3.3/vendor/hashbin-sdk-v0.4.0.mjs'),'sha384-zzmaXw5svWRp0YF//G5ytyeqEowixccM/hHVDth46FnGrIlPS7fPki5vbhv+bWCr');

 const sdk=fs.readFileSync(path.join(__dirname,'../vendor/fragment-kit-v0.3.3/vendor/hashbin-sdk-v0.4.0.mjs'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const bootstrap=/SANDBOX_BOOTSTRAP = (".*?");\n/.exec(sdk)[1],hash="'sha256-"+crypto.createHash('sha256').update(JSON.parse(bootstrap)).digest('base64')+"'";
 const csp=/Content-Security-Policy" content="([^"]+)"/.exec(html)[1],scripts=/script-src ([^;]+)/.exec(csp)[1].split(' ');
 assert.ok(scripts.includes(hash),hash);assert.ok(!scripts.includes("'unsafe-inline'")&&!scripts.includes("'unsafe-eval'"));
 assert.ok(!/<script>/.test(html),'no inline scripts in index.html');
 assert.match(html,/name="hashbin-client-id" content="app_da72a010-439f-4772-b664-791ed9333c29"/);
});

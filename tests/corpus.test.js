const test=require('node:test'),assert=require('node:assert/strict');
const {urlState,type,HashBinDocuments:Docs,publishTransactions}=require('../src/fragment-config.mjs');
const {compress}=require('../vendor/fragment-kit-v0.3.5/src/index.js');
const corpus=require('./legacy-urls.json');
test('the harvested legacy URL corpus keeps source, notation type, settings and files',()=>{
 let checked=0;for(const entry of corpus.cases){if(entry.kind!=='source')continue;const intent=urlState.parse(entry.href);assert.equal(intent.kind,'source');const expected=entry.raw?Docs.parse(entry.raw):Docs.parse(entry.src);assert.deepEqual(intent.doc,type.normalize(expected));checked++;}assert.ok(checked>=4);
});
test('writers keep the original audio envelope while the shared audio envelope is readable',()=>{
 const raw={src:'bd sn',type:'pattern',settings:{sampleRate:22050,channels:1,renderer:'pattern'},files:{'x.wav':'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='}};
 const href=urlState.build(raw,{url:'https://audio.hashbin.page/?example=hello',run:false}).href;
 const url=new URL(href),payload=require('../vendor/fragment-kit-v0.3.5/src/index.js').decompress(url.searchParams.get('doc'));
 assert.equal(JSON.parse(payload).format,'hashbin-audio');assert.equal(JSON.parse(payload).type,'pattern');assert.deepEqual(urlState.parse(href).doc,type.normalize(raw));assert.equal(urlState.parse(href).run,false);assert.ok(!url.searchParams.has('example'));
 const canonical=urlState.documents.serialize(raw);assert.equal(JSON.parse(canonical).type,'audio');assert.deepEqual(urlState.parse('https://audio.hashbin.page/#v1.'+compress(canonical)).doc,type.normalize(raw));
 assert.throws(()=>urlState.parse('https://audio.hashbin.page/?doc=bad#v2.x'),/Unsupported/);
});
test('Publish transaction compatibility is scoped to this client and all new writes are prefixed',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 values.set('hashbin:publish:client:old','old');values.set('hashbin:publish:other:old','foreign');values.set('hashbin:tokens:client','credential');
 const tx=publishTransactions(storage,'client');assert.equal(tx.getItem('hashbin:publish:client:old'),'old');assert.equal(tx.getItem('hashbin:publish:other:old'),null);assert.equal(tx.getItem('hashbin:tokens:client'),null);
 tx.setItem('hashbin:publish:client:new','new');assert.equal(values.get('audioonline:hashbin:publish:client:new'),'new');assert.equal(values.has('hashbin:publish:client:new'),false);
 tx.removeItem('hashbin:publish:client:old');assert.equal(values.has('hashbin:publish:client:old'),false);assert.equal(values.get('hashbin:publish:other:old'),'foreign');
});

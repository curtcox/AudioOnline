import * as kit from '../vendor/fragment-kit-v0.3.5/src/index.js';
import * as Core from './audio-core.js';
import * as Files from './audio-files.js';
import appConfig from '../fragment-kit.config.json' with {type:'json'};
const AudioCore=Core.default??globalThis.AudioCore,AudioFiles=Files.default??globalThis.AudioFiles;
export const config=kit.createConfig(appConfig);
export const type={type:'audio',settingsKeys:['rate','ch','scene'],fileName:'scene.json',contentType:'application/json',
 normalize(value){
  if(typeof value?.src!=='string')throw Error('Source must be text.');
  if(value.audio!=null&&(typeof value.audio!=='object'||Array.isArray(value.audio)))throw Error('Audio settings must be an object.');
  const audio=value.audio??{},kind=audio.type??value.type??'python';
  if(!AudioCore.TYPES.includes(kind))throw Error('This document needs a newer version of Audio Online.');
  const files=value.files??{};AudioFiles.validate(files,value.src);
  return {src:value.src,audio:{type:kind,settings:AudioCore.options(audio.settings??value.settings)},files:{...files}};
 },isDefault:doc=>doc.audio.type==='python'&&!Object.keys(doc.files).length&&JSON.stringify(doc.audio.settings)===JSON.stringify(AudioCore.options()),
 parseLegacy(text){let value;try{value=JSON.parse(text);}catch{return undefined;}if(value?.format!=='hashbin-audio')return undefined;if(value.version!==1)throw Error('Unsupported saved document version.');return type.normalize(value);}
};
export const fromDocument=value=>{const doc=type.normalize(value);return {src:doc.src,type:doc.audio.type,settings:doc.audio.settings,files:doc.files};};
// The fleet still writes the existing hashbin-audio envelope until all readers are deployed.
export const serializeLegacy=value=>{const doc=fromDocument(value);return kit.bounded(JSON.stringify({format:'hashbin-audio',version:1,src:doc.src,type:doc.type,settings:doc.settings,files:doc.files}),config.maxBytes);};
export const legacyWriter=(doc,{url,run,view,compress})=>{url.searchParams.set(type.isDefault(doc)?'compressed':'doc',compress(type.isDefault(doc)?doc.src:serializeLegacy(doc)));if(run===false)url.searchParams.set('run','0');if(view)url.searchParams.set('view',view);return url.href;};
export const urlState=kit.createUrlState({config,type,legacyWriter,legacyReaders:[(url,{documents})=>!url.hash&&!url.searchParams.has('doc')&&url.searchParams.has('raw')?documents.parse(url.searchParams.get('raw')):null]});
export const HashBinDocuments={...urlState.documents,MAX_BYTES:config.maxBytes,MAX_SAMPLE_BYTES:16*1024*1024,TYPES:AudioCore.TYPES,serialize:serializeLegacy,parse:text=>fromDocument(urlState.documents.parse(text)),
 ...Object.fromEntries(['bytes','encode64','decode64','isCID','cidLength','verify'].map(key=>[key,kit[key]])),cid:value=>kit.cid(value,config.allowedHosts),link:urlState.link};
export function publishTransactions(storage,clientId=config.hashbinClientId){if(!storage)return undefined;const current=kit.createStorage({prefix:config.storagePrefix,storage}),owned=key=>key.startsWith('hashbin:publish:'+clientId+':');return {getItem(key){const value=current.getItem(key);if(value!=null||!owned(key))return value;try{return storage.getItem(key);}catch{return null;}},setItem:(key,value)=>current.setItem(key,value),removeItem(key){current.removeItem(key);if(owned(key))try{storage.removeItem(key);}catch{}}};}
export class HashBinStore extends kit.HashBinStore{
 constructor(options={}){let storage;try{storage=globalThis.sessionStorage;}catch{}super({config,type,transactionStorage:publishTransactions(storage,options.clientId??config.hashbinClientId),...options});this.documents={...this.documents,serialize:serializeLegacy};}
 async load(value){return fromDocument(await super.load(value));}
 async sample(cid,{signal}={}){
  if(!kit.isCID(cid))throw Error('Sample(cid=...) needs a valid HashBin CID.');const length=kit.cidLength(cid);
  if(length>HashBinDocuments.MAX_SAMPLE_BYTES)throw Error('CID samples are limited to 16 MiB.');
  if(length<=64){const data=kit.decode64(cid.slice(8),64);await kit.verify(cid,data);return data;}
  return kit.HashBinStore.prototype.bounded.call({timers:this.timers,timeout:60000},async own=>{
   const response=await this.fetchSource('https://256t.us/'+cid,{signal:signal&&AbortSignal.any?AbortSignal.any([signal,own]):own});
   if(!response.ok)throw Error(response.status===404?'The CID sample was not found on HashBin.':`Loading the CID sample failed (HTTP ${response.status}).`);
   const data=await kit.readResponse(response,Math.min(length,HashBinDocuments.MAX_SAMPLE_BYTES));await kit.verify(cid,data);return data;
  });
 }
}
export const ShareLinks={build:({url,run,view,...doc})=>urlState.build(doc,{url,run,view}),parse:href=>{const intent=urlState.parse(href);return intent.kind==='none'?null:{...intent,...(intent.doc?fromDocument(intent.doc):{})};}};
export const LZString={compressToEncodedURIComponent:kit.compress,decompressFromEncodedURIComponent:kit.decompress};
export {ShareClient} from '../vendor/fragment-kit-v0.3.5/src/index.js';

import {test} from '@playwright/test';
import {createRequire} from 'node:module';
const manifest=createRequire(import.meta.url)('./offline-assets.js');
test.setTimeout(120000);
export default {
 ready:'body[data-ready="true"]',editor:'#editor',status:'#error',draftKey:'audioonline:document',more:'#more-toggle',share:'#share',qr:'#qr-open',tabs:['Code','Preview'],example:'hello',cachePrefix:manifest.version,offlineAsset:'src/app.css',kitURL:'./vendor/fragment-kit-v0.3.5/src/index.js',
 isWrittenURL:href=>{const url=new URL(href);return url.searchParams.has('doc')||url.searchParams.has('compressed');},
 getSource:page=>page.evaluate(()=>AudioOnline.editor.getValue()),getDocument:page=>page.evaluate(()=>AudioOnline.snapshot()),edit:(page,src)=>page.evaluate(src=>AudioOnline.editor.setValue(src,-1),src),
 openMore:async page=>{if(!await page.locator('#fk-more-drawer').isVisible())await page.locator('#more-toggle').click();},
 configureHashBin:async(context,clientId)=>context.route('**/',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/name="hashbin-client-id" content="[^"]*"/,`name="hashbin-client-id" content="${clientId}"`)});}),
 build:(page,doc,canonical=false)=>page.evaluate(async({doc,canonical})=>{const{urlState,config}=await import('./src/fragment-config.mjs');return urlState.build(doc,canonical?{url:config.canonicalOrigin}:{}).href;},{doc,canonical})
};

const fs=require('fs');const E=['chromium','firefox','webkit'];const R={};for(const e of E){try{R[e]=JSON.parse(fs.readFileSync(`results/${e}.json`))}catch{R[e]={}}}
const get=(o,p)=>p.split('.').reduce((a,k)=>a==null?a:a[k],o);
const row=(label,p,f=v=>v)=>{const vals=E.map(e=>{const v=get(R[e],p);return v===undefined?'—':f(v)});const same=new Set(vals).size===1;console.log(label.padEnd(34),...vals.map(v=>String(typeof v==='object'?JSON.stringify(v):v).slice(0,40).padEnd(42)),same?'SAME':'')};
console.log('browser'.padEnd(34),...E.map(e=>String(R[e].browserVersion||R[e].fatal||'').padEnd(42)));
for(const ctx of ['editorOrigin','opaqueWindow']){console.log('--',ctx);row('caps.OfflineAudioContext',ctx+'.caps.OfflineAudioContext');row('isSecureContext',ctx+'.caps.isSecureContext');row('fatal',ctx+'.fatal');
for(const c of Object.keys(get(R.chromium,ctx+'.cases')||{})){row(c+' hash',ctx+'.cases.'+c+'.hash');row(c+' repeatSame',ctx+'.cases.'+c+'.repeatSame');row(c+' peak/rms',ctx+'.cases.'+c,v=>v.error?'ERR '+v.error:v.peak+'/'+v.rms)}
row('speed60s x realtime',ctx+'.speed60s.realtimeX');row('worklet blob',ctx+'.worklet_blob',v=>v.ok?'ok':String(v.error).slice(0,40));row('worklet data',ctx+'.worklet_data',v=>v.ok?'ok':String(v.error).slice(0,40));}
console.log('-- editor vs opaque window same hashes per engine');for(const e of E){const a=get(R[e],'editorOrigin.cases')||{},b=get(R[e],'opaqueWindow.cases')||{};console.log(e,Object.keys(a).every(k=>a[k].hash===b[k]?.hash))}
console.log('-- sdkWorker');const w='sdkWorker';row('fatal',w+'.fatal');
for(const k of Object.keys(get(R.chromium,w+'.caps')||{}).filter(k=>k!=='ua'))row('caps.'+k,w+'.caps.'+k);
row('encoders',w+'.encoders');
for(const k of Object.keys(get(R.chromium,w+'.math')||{}))row('math.'+k,w+'.math.'+k);
row('pureDsp',w+'.pureDsp.hash');row('libmDsp',w+'.libmDsp.hash');
for(const k of ['abcjs.events','abcjs.eventsHash','abcjs.setUpAudio','abcjs.error','zzfx.coin.hash','zzfx.boom.hash','zzfx.laser.hash','zzfx.error','jsfxr.hash','jsfxr.error','pico.hash','pico.seconds','pico.peak','pico.synthMs','pico.error','pyodide.synthHash','pyodide.fftHash','pyodide.libmHash','pyodide.bootMs','pyodide.numpyMs','pyodide.runMs','pyodide.error'])row(k,w+'.'+k);
row('worker ms',w+'.ms');

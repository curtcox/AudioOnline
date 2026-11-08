import {mountGallery} from '../vendor/fragment-kit-v0.3.5/src/index.js';
import {urlState} from './fragment-config.mjs';
const samples=AudioExamples.catalog;
const container=document.getElementById('gallery');
// Gallery links always open the editor; they never point back at gallery.html.
const state={build:doc=>urlState.build(doc,{url:new URL('./',location.href).href})};
mountGallery({container,urlState:state,catalog:samples.map(sample=>({id:sample.id,title:sample.title,tags:sample.tags,description:sample.description,document:{src:sample.source,type:sample.type||'python',files:sample.files||{}},cover:'gallery/covers/'+sample.id+'.png'}))});
container.querySelector('input').id='search';container.querySelector('select').id='tag';container.querySelector('[role=status]').id='count';
const grid=container.querySelector('.fk-gallery-grid');
const decorate=()=>{
 for(const card of grid.children){
  const sample=samples.find(sample=>card.querySelector('h2').textContent===sample.title);if(!sample||card.dataset.preview)continue;
  card.dataset.preview='true';card.id=sample.id;card.classList.add('card');
  const link=card.querySelector('a');link.classList.add('load');link.textContent='Load in editor →';link.setAttribute('aria-label',`Load ${sample.title} in editor`);
  if(sample.neural){const note=document.createElement('p');note.className='neural';note.textContent=`Needs the ${sample.neural} neural voice, downloaded only after confirmation in the editor and not part of “Available offline”. The cover uses the bundled voice.`;link.before(note);}
  else{const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=`gallery/previews/${sample.id}.m4a`;audio.setAttribute('aria-label',`Preview of ${sample.title}`);audio.addEventListener('play',()=>{for(const other of grid.querySelectorAll('audio'))if(other!==audio)other.pause();});link.before(audio);}
 }
};
// Shared filtering replaces cards. Pause removed media and add only Audio's media controls.
new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)node.querySelector?.('audio')?.pause();decorate();}).observe(grid,{childList:true});decorate();

import {RenderManager} from './render-manager';
export {RenderManager} from './render-manager';
import { assets, registerAsset } from './data';

import { useStudio } from './store';

import { regionDefaults, type DetectionResult, type Landmark, type Project, type RenderOutput, type RenderSpec, type Source } from './types';

import {mirrorMask,reviewAutoGuides,withShapeControls,fitUnreviewed} from './features';
import {refreshDefaultLayout} from './default-template';
import {withMeasuredDetail,measuredDetailDefinitions} from './measured-detail';

import {useLibrary,libraryBlob,libraryPreparation,type LibraryEntry} from './library';

import {targetLandmarks} from './engine/math';
import {chooseFace,cancelFaceChoices} from './face-selection';
import {replaceSource} from './replace-source';
import {faceCropBounds,cropDetection,cropSourceCoordinates} from './face-crop';
import calibration from './detector-calibration.json';
import {CALIBRATION_VERSION,FIT_VERSION} from './engine/fitting';
import {excludeSelection} from './mask-selection';

export const baseURL=new URL(import.meta.env.BASE_URL,location.href).href;

const id=()=>crypto.randomUUID();

let inference:Worker|undefined,ready:Promise<void>|undefined,generation=0;
let initializationReject:((error:Error)=>void)|undefined,initializationTimer:ReturnType<typeof setTimeout>|undefined;
class InferenceFailure extends Error {}
const detectionJobs=new Map<string,{resolve:(r:DetectionResult&{found?:boolean})=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function failInference(message:string,retryable=true){
 const error=retryable?new InferenceFailure(message):new Error(message),worker=inference;
 inference=undefined;ready=undefined;clearTimeout(initializationTimer);initializationTimer=undefined;
 initializationReject?.(error);initializationReject=undefined;
 for(const job of detectionJobs.values()){clearTimeout(job.timer);job.reject(error);}detectionJobs.clear();worker?.terminate();
}

export function startInference():Promise<void>{
 if(ready)return ready;
 let resolve!:()=>void;
 const promise=ready=new Promise<void>((ok,reject)=>{resolve=ok;initializationReject=reject;});
 try{
  const worker=new Worker(new URL('workers/inference.worker.js?v=1.6.1',baseURL));inference=worker;
  initializationTimer=setTimeout(()=>{if(inference===worker)failInference('Automatic setup timed out. Check the connection and try Detect again.');},60000);
  worker.onmessage=e=>{
   if(inference!==worker)return;const m=e.data;
   if(m.type==='ready'){clearTimeout(initializationTimer);initializationTimer=undefined;initializationReject=undefined;resolve();}
   else if(m.type==='detected'||m.type==='error'){
    const job=detectionJobs.get(m.job);
    if(job){clearTimeout(job.timer);detectionJobs.delete(m.job);if(m.type==='detected')job.resolve(m);else job.reject(new Error(m.message));}
    else if(m.type==='error'&&!m.job)failInference(m.message||'Automatic setup stopped. Try Detect again.');
   }
  };
  worker.onerror=e=>{e.preventDefault?.();if(inference===worker)failInference(e.message||'The detector stopped. Try Detect again.');};
  worker.onmessageerror=()=>{if(inference===worker)failInference('The detector response could not be read.');};
  worker.postMessage({type:'init',base:baseURL,template:useStudio.getState().project.template,calibration,calibrationVersion:CALIBRATION_VERSION});
 }catch(error){failInference(String(error));}
 return promise;
}

async function detectOnce(blob:Blob,mine:number):Promise<DetectionResult&{found?:boolean}>{
 await startInference();if(mine!==generation)throw new Error('Preparation cancelled.');
 const job=id(),worker=inference!;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{if(inference===worker)failInference('Image preparation timed out. Try Detect again or place the landmarks manually.');},45000);
  detectionJobs.set(job,{resolve,reject,timer});
  try{worker.postMessage({type:'template',template:useStudio.getState().project.template});worker.postMessage({type:'detect',job,blob});}
  catch(error){failInference(String(error));}
 });
}
let detectionQueue:Promise<unknown>=Promise.resolve();
export function detect(blob:Blob):Promise<DetectionResult&{found?:boolean}>{
 const mine=generation;
 const pending=detectionQueue.then(async()=>{
  for(let attempt=0;;attempt++){
   if(mine!==generation)throw new Error('Preparation cancelled.');
   try{return await detectOnce(blob,mine);}catch(error){if(attempt||mine!==generation||!(error instanceof InferenceFailure))throw error;}
  }
 });
 detectionQueue=pending.catch(()=>{});return pending;
}

export function cancelPreparation(){generation++;cancelFaceChoices();failInference('Preparation cancelled.',false);useStudio.getState().change(p=>({...p,sources:p.sources.map(s=>s.status==='preparing'?{...s,status:'manual',note:'Preparation cancelled. Landmarks remain editable.'}:s)}),false);useStudio.getState().setStatus('Preparation cancelled');}

/** Cached masks make subsequent selections independent of model inference. */
export async function excludeAutomatic(sourceId:string,kind:'hair'|'accessories'){
 const mine=generation,state=useStudio.getState();let source=state.project.sources.find(s=>s.id===sourceId);const asset=assets.get(sourceId);if(!source||!asset)return;
 state.setStatus('Preparing selection...',true);
 try{
  if(!source.analysisMasks?.[kind]){const result=await detect(asset.blob);if(mine!==generation)return;const current=useStudio.getState().project.sources.find(s=>s.id===sourceId);if(!current)return;useStudio.getState().updateSource(sourceId,{analysisMasks:result.analysisMasks??current.analysisMasks},false);}
  source=useStudio.getState().project.sources.find(s=>s.id===sourceId);const selection=source?.analysisMasks?.[kind];
  if(!source||!selection)return void state.notify('Selection unavailable. Use the Remove brush or Polygon.');
  if(!selection.data.some(v=>v>102))return void state.notify('No clear selection found. Use the Remove brush or Polygon.');
  useStudio.getState().updateSource(sourceId,{exclusionMask:excludeSelection(selection,source.exclusionMask,source.width,source.height,kind,source.analysisMasks)});
  state.notify(kind==='hair'?'Hair selection applied. Refine it with Keep or Remove.':'Accessory selection applied. Check glasses and refine with Keep or Remove.');
 }catch(error){state.notify(String(error));}finally{useStudio.getState().setStatus('Ready');}
}

export async function analyzeSource(sourceId:string,maskOnly=false){

 const state=useStudio.getState(),source=state.project.sources.find(s=>s.id===sourceId),asset=assets.get(sourceId);if(!source||!asset)return;

 if(!maskOnly&&source.status!=='preparing')state.checkpoint();
 state.updateSource(sourceId,{status:'preparing'},false);const mine=generation;

 try{let result=await detect(asset.blob);if(mine!==generation)return;if(!maskOnly){const selected=await selectFace(source,result);result=selected.result;sourceId=selected.sourceId;}if(mine!==generation)return;const current=useStudio.getState().project.sources.find(s=>s.id===sourceId);if(!current)return;const incoming=new Map(result.landmarks.map(p=>[p.id,p]));

  if(maskOnly){useStudio.getState().updateSource(sourceId,{subjectMask:result.mask??current.subjectMask,analysisMasks:result.analysisMasks??current.analysisMasks,status:source.status==='preparing'?(result.found?'ready':'manual'):source.status,note:result.mask?'Automatic subject mask refreshed.':result.note},false);return;}
  if(result.found===false){useStudio.getState().updateSource(sourceId,{subjectMask:current.subjectMask??result.mask,status:'manual',note:`${result.note??'No face detected.'} Existing controls kept. Review their positions or try detection again.`},false);return;}
  const pins=source.status==='preparing'&&!source.featurePoints?{}:useStudio.getState().project.recipe.pins,landmarks=current.landmarks.map(p=>p.authored||p.locked||(!p.enabled&&!p.autoDisabled)||pins[p.id]?p:incoming.get(p.id)??p);useStudio.getState().updateSource(sourceId,{landmarks,fitVersion:result.fitVersion,featurePoints:result.featurePoints,observation:result.observation,analysisMasks:result.analysisMasks,subjectMask:current.subjectMask??result.mask,status:result.found?'ready':'manual',note:result.note},false);useStudio.getState().change(p=>withMeasuredDetail(reviewAutoGuides(withShapeControls(p))),false);

 }catch(error){if(mine===generation)useStudio.getState().updateSource(sourceId,{status:'manual',note:String(error)},false);}

}

async function selectFace(source:Source,result:DetectionResult&{found?:boolean}):Promise<{result:DetectionResult&{found?:boolean};sourceId:string}>{
 const unchanged=(result:DetectionResult&{found?:boolean})=>({result,sourceId:source.id});
 if(!result.faces||result.faces.length<2)return unchanged(result);
 useStudio.getState().setStatus('Choose a face',true);
 const choice=await chooseFace(source.name,assets.get(source.id)!.url,result.faces);
 if(!choice)return unchanged({...result,landmarks:source.landmarks,faces:undefined,found:false,note:'Automatic placement skipped. Place points manually.'});
 const selected={...result,...result.faces[choice.index],faces:undefined};
 if(!choice.crop)return unchanged(selected);
 const current=useStudio.getState().project.sources.find(s=>s.id===source.id);if(!current)return unchanged(selected);
 const rect=faceCropBounds(result.faces[choice.index].bounds,current.width,current.height),image=await createImageBitmap(assets.get(current.id)!.blob);
 const incoming=new Map(selected.landmarks.map(p=>[p.id,p]));
 const pins=source.status==='preparing'&&!source.featurePoints?{}:useStudio.getState().project.recipe.pins;
 const full:Source={...current,landmarks:current.landmarks.map(p=>p.authored||p.locked||(!p.enabled&&!p.autoDisabled)||pins[p.id]?p:incoming.get(p.id)??p),featurePoints:selected.featurePoints,observation:selected.observation,analysisMasks:selected.analysisMasks,fitVersion:selected.fitVersion,subjectMask:current.subjectMask??selected.mask,status:'ready',note:selected.note};
 const next={...cropSourceCoordinates(full,rect),id:id(),originalAssetId:current.originalAssetId??current.id},canvas=new OffscreenCanvas(next.width,next.height);
 canvas.getContext('2d')!.drawImage(image,Math.round(rect[0]*current.width),Math.round(rect[1]*current.height),next.width,next.height,0,0,next.width,next.height);image.close();registerAsset(next.id,await canvas.convertToBlob({type:'image/png'}));
 const state=useStudio.getState(),view={inspectSource:state.inspectSource===current.id?next.id:state.inspectSource,isolatedSource:state.isolatedSource===current.id?next.id:state.isolatedSource};
 state.updateSource(current.id,full,false);state.change(p=>replaceSource(p,current.id,next));state.selectSource(next.id);useStudio.setState(view);
 return {result:{...cropDetection(selected,rect),found:true},sourceId:next.id};
}

async function sourceFromBlob(blob:Blob,name:string,points?:Record<string,number[]>):Promise<Source>{

 const bitmap=await createImageBitmap(blob),width=bitmap.width,height=bitmap.height;bitmap.close();const sourceId=id();registerAsset(sourceId,blob);

 return {id:sourceId,name,width,height,enabled:true,shapeWeight:1,appearanceWeight:1,weightLocked:false,regionWeights:regionDefaults(),landmarks:useStudio.getState().project.template.points.map((def,i)=>({id:def.id,x:points?.[def.id]?.[0]??def.reference[0],y:points?.[def.id]?.[1]??def.reference[1],enabled:true,locked:false,authored:!!points,confidence:points?1:.2})),status:'preparing'};

}

/** Add a rendered portrait without changing the existing mixture. */

export async function addRenderedSource(blob:Blob,snapshot:Project){

 const state=useStudio.getState();

 if(state.project.id!==snapshot.id)throw new Error('The project changed. Render the mix again.');

 if(state.project.sources.length>=30)throw new Error('The mix already has 30 sources.');

 const source=await sourceFromBlob(blob,`${snapshot.name} mix`);

 if(!snapshot.recipe.flipOutput)source.landmarks=targetLandmarks(snapshot).map(p=>({...p,authored:true,confidence:1}));

 source.shapeWeight=0;source.appearanceWeight=0;source.status='ready';source.provenance='Local mixed result';

 const current=useStudio.getState();

 if(current.project.id!==snapshot.id||current.project.sources.length>=30)throw new Error('The project changed. Render the mix again.');

 current.change(p=>({...p,sources:[...p.sources,source]}));current.selectSource(source.id);

 if(snapshot.recipe.flipOutput)await analyzeSource(source.id,false);
 if(snapshot.recipe.background==='transparent'){

  const bm=await createImageBitmap(blob),scale=Math.min(1,512/bm.height),c=new OffscreenCanvas(Math.round(bm.width*scale),Math.round(bm.height*scale)),ctx=c.getContext('2d')!;

  ctx.drawImage(bm,0,0,c.width,c.height);bm.close();const pixels=ctx.getImageData(0,0,c.width,c.height).data;

  useStudio.getState().updateSource(source.id,{subjectMask:{width:c.width,height:c.height,data:Uint8Array.from({length:c.width*c.height},(_,i)=>pixels[i*4+3])}},false);

 }else if(!snapshot.recipe.flipOutput)void analyzeSource(source.id,true);

 return source;

}

let importQueue=Promise.resolve();
function queueImport(work:()=>Promise<void>){const mine=generation,pending=importQueue.then(()=>mine===generation?work():undefined);importQueue=pending.catch(()=>{});return pending;}
export function importPhotos(files:File[]){return queueImport(()=>importPhotosNow(files));}
async function importPhotosNow(files:File[]){

 const mine=generation,state=useStudio.getState(),room=30-state.project.sources.length;if(room<=0){state.notify('This project already has 30 sources.');return;}

 state.setStatus('Importing photos...',true);const added:Source[]=[];const failures:string[]=[];

 for(const file of files.slice(0,room)){if(mine!==generation)break;try{added.push(await sourceFromBlob(file,file.name.replace(/\.[^.]+$/,'')));}catch{failures.push(file.name);}}

 if(mine!==generation)return;const accepted=appendSources(added);if(failures.length)state.notify(`Could not decode ${failures.join(', ')}.`);

 await prepare(accepted);if(files.length>room)state.notify('Imported the first 30 sources.');

}

function appendSources(added:Source[]):Source[]{if(!added.length)return [];const requested=added.length;const state=useStudio.getState();state.change(p=>{added=added.slice(0,Math.max(0,30-p.sources.length));let sources=[...p.sources,...added];for(const key of ['shapeWeight','appearanceWeight'] as const){const locked=p.sources.filter(s=>s.enabled&&s.weightLocked).reduce((sum,s)=>sum+s[key],0),unlocked=p.sources.filter(s=>s.enabled&&!s.weightLocked),remaining=Math.max(0,100-locked),oldTotal=unlocked.reduce((sum,s)=>sum+s[key],0),perNew=remaining/Math.max(1,unlocked.length+added.length),newIds=new Set(added.map(s=>s.id));sources=sources.map(s=>newIds.has(s.id)?{...s,[key]:perNew}:s.enabled&&!s.weightLocked?{...s,[key]:oldTotal>0?s[key]/oldTotal*(remaining-perNew*added.length):(remaining-perNew*added.length)/Math.max(1,unlocked.length)}:s);}return withMeasuredDetail(reviewAutoGuides(withShapeControls({...p,sources})));});if(added[0])state.selectSource(added[0].id);if(added.length<requested)state.notify(`Added ${added.length}. The mix supports 30 sources.`);return added;}

export function importLibraryEntries(entries:LibraryEntry[]){return queueImport(()=>importLibraryEntriesNow(entries));}
async function importLibraryEntriesNow(entries:LibraryEntry[]){const mine=generation,room=30-useStudio.getState().project.sources.length,added:Source[]=[];useStudio.getState().setStatus('Adding library photos...',true);try{for(const entry of entries.slice(0,Math.max(0,room))){if(mine!==generation)break;const blob=await libraryBlob(entry),source=await sourceFromBlob(blob,entry.name),prepared=await libraryPreparation(entry);if(prepared?.landmarks.length){const snapshot=structuredClone(prepared),points=new Map(snapshot.landmarks.map(p=>[p.id,p]));Object.assign(source,snapshot,{id:source.id,name:entry.name,enabled:true,weightLocked:false,shapeWeight:1,appearanceWeight:1,regionWeights:regionDefaults(),landmarks:[...source.landmarks.map(p=>points.get(p.id)??p),...snapshot.landmarks.filter(p=>measuredDetailDefinitions.some(d=>d.id===p.id)&&!source.landmarks.some(d=>d.id===p.id))]});}if(entry.mask&&!source.subjectMask){const response=await fetch(new URL(entry.mask,baseURL));if(response.ok){const bm=await createImageBitmap(await response.blob()),c=new OffscreenCanvas(bm.width,bm.height),ctx=c.getContext('2d')!;ctx.drawImage(bm,0,0);bm.close();const rgba=ctx.getImageData(0,0,c.width,c.height).data;source.subjectMask={width:c.width,height:c.height,data:Uint8Array.from({length:c.width*c.height},(_,i)=>rgba[i*4])};}}source.provenance=entry.provenance;const activeTemplate=useStudio.getState().project.template;added.push(activeTemplate.id==='face-controls'?fitUnreviewed(source,activeTemplate):source);}if(mine!==generation)return;const accepted=appendSources(added);if(entries.length>room)useStudio.getState().notify(`Added ${added.length}; the mix supports up to 30 sources.`);await prepare(accepted.filter(s=>s.status==='preparing'));await useLibrary.getState().markUsed(entries.slice(0,accepted.length).map(e=>e.id));}finally{useStudio.getState().setStatus('Ready');}}

function currentFaceNose(source:Source):[number,number]{const nose=source.featurePoints?.['mp-1'];if(nose)return nose;const p=source.landmarks.find(p=>p.id==='p55');return p?[p.x,p.y]:[.5,.5];}

export async function flipSource(sourceId:string){

 const state=useStudio.getState(),source=state.project.sources.find(s=>s.id===sourceId),asset=assets.get(sourceId);if(!source||!asset||state.busy)return;

 state.setStatus('Flipping photo...',true);const mine=generation;

 try{

  const bitmap=await createImageBitmap(asset.blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d')!;

  ctx.translate(bitmap.width,0);ctx.scale(-1,1);ctx.drawImage(bitmap,0,0);bitmap.close();

  const blob=await canvas.convertToBlob({type:'image/png'}),prepared=await sourceFromBlob(blob,source.name);

  // A physical image flip followed by the same detection used on import.

  // The asymmetric correspondence template must never be reflected by ID.

  let result=await detect(blob);if(result.faces?.length){const nose=currentFaceNose(source);const selected=result.faces.slice().sort((a,b)=>Math.hypot((a.featurePoints?.['mp-1']?.[0]??.5)-(1-nose[0]),(a.featurePoints?.['mp-1']?.[1]??.5)-nose[1])-Math.hypot((b.featurePoints?.['mp-1']?.[0]??.5)-(1-nose[0]),(b.featurePoints?.['mp-1']?.[1]??.5)-nose[1]))[0];result={...result,...selected,faces:undefined};}if(mine!==generation)return;

  const current=useStudio.getState().project.sources.find(s=>s.id===sourceId);if(!current)return;

  const next:Source={...current,id:prepared.id,originalAssetId:current.originalAssetId??current.id,width:prepared.width,height:prepared.height,landmarks:result.landmarks,fitVersion:result.fitVersion,featurePoints:result.featurePoints,observation:result.observation,analysisMasks:result.analysisMasks,subjectMask:result.mask,exclusionMask:mirrorMask(current.exclusionMask),status:result.found?'ready':'manual',note:result.note};

  const view={inspectSource:state.inspectSource===sourceId?next.id:state.inspectSource,isolatedSource:state.isolatedSource===sourceId?next.id:state.isolatedSource};
  state.change(p=>reviewAutoGuides(replaceSource(p,sourceId,next)));
  state.selectSource(next.id);useStudio.setState(view);

  state.notify('Photo flipped. Landmarks detected again. Undo restores the source.');

 }catch(error){state.notify(String(error));}finally{state.setStatus('Ready');}

}

async function prepare(sources:Source[],maskOnly=false){const mine=generation;for(let i=0;i<sources.length;i++){if(mine!==generation)break;useStudio.getState().setStatus(`Preparing ${i+1} of ${sources.length} / ${sources[i].name}`,true);await analyzeSource(sources[i].id,maskOnly);}if(mine===generation)useStudio.getState().setStatus('Ready');}

export async function loadDemo(group:'reference',replace=false){

 const state=useStudio.getState();state.setStatus('Opening sample photos...',true);

 try{const fixture=await (await fetch(baseURL+'demo/fixture.json')).json();const entries=fixture.sources;const room=replace?30:30-state.project.sources.length;const sources:Source[]=[];if(replace)state.change(p=>({...p,sources:[],recipe:{...p.recipe,pins:{}},template:fixture.template}));

  for(const entry of entries.slice(0,room)){const response=await fetch(baseURL+entry.url);const source=await sourceFromBlob(await response.blob(),entry.name,Object.fromEntries(fixture.template.points.map((d:{id:string},i:number)=>[d.id,entry.points[i]])));

   source.featurePoints=entry.featurePoints;source.observation=entry.observation;

   if(entry.preparedLandmarks){const points=new Map<string,Source['landmarks'][number]>(entry.preparedLandmarks.map((p:Source['landmarks'][number])=>[p.id,p]));source.landmarks=source.landmarks.map(p=>points.get(p.id)??(entry.featurePoints?.[p.id]?{...p,x:entry.featurePoints[p.id][0],y:entry.featurePoints[p.id][1],confidence:.94}:p));source.note='Automatic sample placement. Review estimated controls around hidden features.';}

   if(entry.mask){try{const response=await fetch(baseURL+entry.mask);if(response.ok){const bm=await createImageBitmap(await response.blob()),c=new OffscreenCanvas(bm.width,bm.height),ctx=c.getContext('2d')!;ctx.drawImage(bm,0,0);bm.close();const rgba=ctx.getImageData(0,0,c.width,c.height).data;source.subjectMask={width:c.width,height:c.height,data:Uint8Array.from({length:c.width*c.height},(_,i)=>rgba[i*4])};source.status='ready';}}catch{}}

   sources.push(source);}

  appendSources(sources);state.change(p=>withMeasuredDetail(refreshDefaultLayout(p)),false);await prepare(sources.filter(s=>s.status==='preparing'),group==='reference');

 }catch(error){state.setStatus('Sample loading failed');state.notify(String(error));}

}

export async function renderExport(project:Project,size=project.recipe.outputSize,inspectSourceId?:string,signal?:AbortSignal):Promise<RenderOutput>{const manager=new RenderManager();return new Promise((resolve,reject)=>{const abort=()=>{manager.dispose();reject(new DOMException('Export cancelled','AbortError'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});manager.onResult=r=>{signal?.removeEventListener('abort',abort);manager.dispose();resolve(r);};manager.onError=e=>{signal?.removeEventListener('abort',abort);manager.dispose();reject(new Error(e));};manager.render({revision:project.revision,sources:project.sources,template:project.template,recipe:project.recipe,size,quality:'final',inspectSourceId});});}

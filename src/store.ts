import { create } from 'zustand';

import {defaultTemplate} from './default-template';

import { defaultRecipe, REGIONS, type Project, type Recipe, type Source, type Template, type Vec } from './types';

import { normalize, sourceAlignment, targetLandmarks, transferPoint } from './engine/math';
import calibration from './detector-calibration.json';

import {withFeatureControls,withShapeControls} from './features';

const uuid=()=>crypto.randomUUID();

export const newProject=():Project=>({schemaVersion:1,engineVersion:2,id:uuid(),name:'Untitled experiment',template:defaultTemplate(),sources:[],recipe:{...defaultRecipe(),earControls:false},variants:[],revision:0});

interface State{

 project:Project;past:Project[];future:Project[];selectedSource:string;selectedPoints:string[];

 workspace:'mix'|'landmarks'|'masks'|'compare';inspector:'mix'|'regions'|'shape'|'landmarks'|'mask'|'finish';

 status:string;busy:boolean;toast:string;compareVariant:string;inspectSource:string;isolatedSource:string;

 change:(fn:(p:Project)=>Project,history?:boolean)=>void;checkpoint:()=>void;undo:()=>void;redo:()=>void;

 selectSource:(id:string)=>void;selectPoints:(ids:string[])=>void;setWorkspace:(s:State['workspace'])=>void;

 setStatus:(text:string,busy?:boolean)=>void;notify:(text:string)=>void;

 updateSource:(id:string,patch:Partial<Source>,history?:boolean)=>void;removeSource:(id:string)=>void;

 setRecipe:(patch:Partial<Recipe>,history?:boolean)=>void;

 setWeight:(id:string,value:number,channel:'shape'|'appearance'|'both',history?:boolean)=>void;

 movePoints:(sourceId:string,updates:Record<string,Vec>,history?:boolean)=>void;

 addPoint:(sourceId:string,position:Vec)=>void;removePoints:()=>void;clearLandmarks:()=>void;resetLandmarks:()=>void;

 addPortraitContours:()=>void;saveVariant:()=>void;loadVariant:(id:string)=>void;

}

let toastTimer:ReturnType<typeof setTimeout>;

export const useStudio=create<State>((set,get)=>({

 project:newProject(),past:[],future:[],selectedSource:'',selectedPoints:[],workspace:'mix',inspector:'mix',status:'Ready',busy:false,toast:'',compareVariant:'',inspectSource:'',isolatedSource:'',

 change:(fn,history=true)=>set(s=>{const next=fn(s.project);let sources=next.sources;for(const key of ['shapeWeight','appearanceWeight'] as const){const total=sources.filter(v=>v.enabled).reduce((sum,v)=>sum+Math.max(0,v[key]),0);if(total>0&&Math.abs(total-100)>1e-8)sources=sources.map(v=>v.enabled?{...v,[key]:Math.max(0,v[key])/total*100}:v);}return {isolatedSource:sources.some(v=>v.id===s.isolatedSource)?s.isolatedSource:'',project:{...next,sources,revision:s.project.revision+1},past:history?[...s.past.slice(-29),s.project]:s.past,future:history?[]:s.future};}),

 checkpoint:()=>set(s=>({past:[...s.past.slice(-29),s.project],future:[]})),

 undo:()=>set(s=>{if(!s.past.length)return {};const project={...s.past.at(-1)!,revision:s.project.revision+1};return {project,past:s.past.slice(0,-1),future:[s.project,...s.future],selectedSource:project.sources.some(v=>v.id===s.selectedSource)?s.selectedSource:project.sources[0]?.id??'',isolatedSource:project.sources.some(v=>v.id===s.isolatedSource)?s.isolatedSource:'',selectedPoints:s.selectedPoints.filter(id=>project.template.points.some(p=>p.id===id))};}),
 redo:()=>set(s=>{if(!s.future.length)return {};const project={...s.future[0],revision:s.project.revision+1};return {project,past:[...s.past,s.project],future:s.future.slice(1),selectedSource:project.sources.some(v=>v.id===s.selectedSource)?s.selectedSource:project.sources[0]?.id??'',isolatedSource:project.sources.some(v=>v.id===s.isolatedSource)?s.isolatedSource:'',selectedPoints:s.selectedPoints.filter(id=>project.template.points.some(p=>p.id===id))};}),

 selectSource:selectedSource=>set(s=>({selectedSource,selectedPoints:s.selectedSource===selectedSource?s.selectedPoints:[],isolatedSource:s.isolatedSource?selectedSource:''})),selectPoints:selectedPoints=>set({selectedPoints}),setWorkspace:workspace=>set(s=>({workspace,inspectSource:'',selectedPoints:workspace==='landmarks'?s.selectedPoints:[],inspector:workspace==='masks'?'mask':workspace==='landmarks'?'landmarks':s.inspector==='mask'?'mix':s.inspector})),

 removeSource:id=>{if(!get().project.sources.some(s=>s.id===id))return;get().change(p=>({...p,sources:p.sources.filter(s=>s.id!==id),recipe:{...p.recipe,backgroundSourceId:p.recipe.backgroundSourceId===id?undefined:p.recipe.backgroundSourceId,regionSources:Object.fromEntries(Object.entries(p.recipe.regionSources??{}).map(([region,donor])=>[region,{shape:donor?.shape===id?undefined:donor?.shape,appearance:donor?.appearance===id?undefined:donor?.appearance}]))}}));set(s=>({selectedSource:s.selectedSource===id?s.project.sources[0]?.id??'':s.selectedSource,inspectSource:s.inspectSource===id?'':s.inspectSource,selectedPoints:[]}));},

 setStatus:(status,busy=false)=>set({status,busy}),notify:toast=>{clearTimeout(toastTimer);set({toast});toastTimer=setTimeout(()=>set({toast:''}),5000);},

 updateSource:(id,patch,history=true)=>get().change(p=>({...p,sources:p.sources.map(s=>s.id===id?{...s,...patch}:s)}),history),

 setRecipe:(patch,history=true)=>get().change(p=>{const next={...p,recipe:{...p.recipe,...patch}};return patch.faceEdits?withShapeControls(next):next;},history),

 setWeight:(id,value,channel,history=true)=>get().change(p=>{

  const selected=p.sources.find(s=>s.id===id);if(!selected||selected.weightLocked)return p;

  let sources=p.sources;const channels=channel==='both'?['shapeWeight','appearanceWeight'] as const:channel==='shape'?['shapeWeight'] as const:['appearanceWeight'] as const;

  for(const key of channels){const active=sources.filter(s=>s.enabled),locked=active.filter(s=>s.weightLocked).reduce((sum,s)=>sum+s[key],0),v=Math.max(0,Math.min(100-locked,value));const others=active.filter(s=>s.id!==id&&!s.weightLocked),sum=others.reduce((total,s)=>total+s[key],0),remaining=Math.max(0,100-locked-v);

   sources=sources.map(s=>s.id===id?{...s,[key]:v}:others.some(o=>o.id===s.id)?{...s,[key]:sum>0?s[key]/sum*remaining:remaining/Math.max(1,others.length)}:s);

  }return {...p,sources};

 },history),

 movePoints:(sourceId,updates,history=true)=>get().change(p=>sourceId==='output'?{...p,recipe:{...p.recipe,pins:{...p.recipe.pins,...Object.fromEntries(Object.entries(updates).map(([id,v])=>[id,[p.recipe.flipOutput?1-v[0]:v[0],v[1]]]))}}}:{...p,sources:p.sources.map(s=>s.id!==sourceId?s:{...s,landmarks:s.landmarks.map(l=>updates[l.id]&&!l.locked?{...l,x:updates[l.id][0],y:updates[l.id][1],authored:true,confidence:1,enabled:l.autoDisabled?true:l.enabled,autoDisabled:undefined,review:undefined}:l)})},history),

 addPoint:(sourceId,position)=>get().change(p=>{

  const id=`custom-${uuid().slice(0,8)}`,ref=p.sources.find(s=>s.id===sourceId);if(!ref)return p;

  if(position.some(v=>!Number.isFinite(v)||v<0||v>1))return p;
  const reference:Source={...ref,width:1229,height:1536,featurePoints:Object.fromEntries(calibration.map((v,i)=>['mp-'+i,v as Vec])),landmarks:p.template.points.map(d=>({id:d.id,x:d.reference[0],y:d.reference[1],enabled:true,locked:false,authored:false,confidence:1}))};
  const referencePosition=transferPoint(ref,reference,position);
  return {...p,template:{...p.template,points:[...p.template.points,{id,name:`Custom ${p.template.points.length+1}`,region:'outline',reference:referencePosition}]},sources:p.sources.map(s=>{const pos=s.id===sourceId?position:transferPoint(ref,s,position);return {...s,landmarks:[...s.landmarks,{id,x:pos[0],y:pos[1],enabled:true,locked:false,authored:s.id===sourceId,confidence:s.id===sourceId?1:.4}]};})};

 }),

 clearLandmarks:()=>{get().change(p=>({...p,template:{id:'custom-controls',version:1,name:'Manual controls',points:[],contours:[]},sources:p.sources.map(s=>({...s,landmarks:[]})),recipe:{...p.recipe,pins:{},faceEdits:{},frameAnchors:false}}));set({selectedPoints:[]});},
 resetLandmarks:()=>{const template=defaultTemplate();get().change(p=>({...p,template,sources:p.sources.map(s=>({...s,landmarks:template.points.map(d=>({id:d.id,x:d.reference[0],y:d.reference[1],enabled:true,locked:false,authored:false,confidence:.2}))})),recipe:{...p.recipe,pins:{},faceEdits:{},frameAnchors:false}}));set({selectedPoints:[]});},
 removePoints:()=>{const ids=get().selectedPoints;get().change(p=>({...p,template:{...p.template,points:p.template.points.filter(d=>!ids.includes(d.id)),contours:p.template.contours.map(c=>({...c,ids:c.ids.filter(id=>!ids.includes(id))}))},sources:p.sources.map(s=>({...s,landmarks:s.landmarks.filter(l=>!ids.includes(l.id)||l.locked)}))}));set({selectedPoints:[]});},

 addPortraitContours:()=>get().change(p=>{

  if(p.template.points.some(d=>d.id==='portrait-ls'))return p;

  const defs=[{id:'portrait-ln',name:'Left neck base',region:'neck' as const,reference:[.38,.79] as Vec},{id:'portrait-rn',name:'Right neck base',region:'neck' as const,reference:[.62,.79] as Vec},{id:'portrait-ls',name:'Left shoulder',region:'clothing' as const,reference:[.09,.82] as Vec},{id:'portrait-rs',name:'Right shoulder',region:'clothing' as const,reference:[.91,.82] as Vec},{id:'portrait-lb',name:'Left garment base',region:'clothing' as const,reference:[.01,.99] as Vec},{id:'portrait-rb',name:'Right garment base',region:'clothing' as const,reference:[.99,.99] as Vec}];

  const calibration={width:1229,height:1536,landmarks:p.template.points.map(d=>({id:d.id,x:d.reference[0],y:d.reference[1]}))} as Source,referenceTransform=sourceAlignment(calibration,p.recipe.aspect,p.recipe.frameScale,p.recipe.frameOffsetY);

  return {...p,template:{...p.template,points:[...p.template.points,...defs.map(d=>({...d,reference:referenceTransform.inverse([d.reference[0]*p.recipe.aspect,d.reference[1]])}))],contours:[...p.template.contours,{name:'Portrait',ids:['portrait-lb','portrait-ls','portrait-ln','portrait-rn','portrait-rs','portrait-rb'],closed:false}]},sources:p.sources.map(s=>{const a=sourceAlignment(s,p.recipe.aspect,p.recipe.frameScale,p.recipe.frameOffsetY);return {...s,landmarks:[...s.landmarks,...defs.map(d=>{let xy=a.inverse([d.reference[0]*p.recipe.aspect,d.reference[1]]);const mask=s.subjectMask;if(mask&&d.region==='clothing'){const row=Math.max(0,Math.min(mask.height-1,Math.round(xy[1]*mask.height))),hits=[];for(let x=0;x<mask.width;x++)if(mask.data[row*mask.width+x]>127)hits.push(x);if(hits.length)xy=[(d.id.endsWith('ls')||d.id.endsWith('lb')?hits[0]:hits.at(-1)!)/mask.width,xy[1]];}return {id:d.id,x:xy[0],y:xy[1],enabled:true,locked:false,authored:false,confidence:.35};})]};})};

 }),

 saveVariant:()=>get().change(p=>({...p,variants:[...p.variants,{id:uuid(),name:`Variant ${p.variants.length+1}`,sources:p.sources,recipe:p.recipe,template:p.template,created:Date.now()}]})),

 loadVariant:id=>{const v=get().project.variants.find(v=>v.id===id);if(v)get().change(p=>{const next={...p,sources:v.sources,recipe:v.recipe,template:v.template??p.template};return next;});}

}));

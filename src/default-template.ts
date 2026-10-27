import {recoverySnapshot} from './variants';
import original from './reference-template.json';
import calibration from './detector-calibration.json';
import type {Landmark,Project,Source,Template} from './types';
import {fitLandmarks,FIT_VERSION} from './engine/fitting';
import {withShapeControls} from './features';

export const OUTLINE_LAYOUT_VERSION=11;
export const retiredDefaultIds=new Set(['p56','p60','p58','p59']);
const removedJunctions=new Set(['p58','p59']);
const deprecatedPointIds=new Set(['lid-160','lid-159','lid-158','lid-153','lid-145','lid-144','lid-385','lid-386','lid-387','lid-373','lid-374','lid-380','lip-0','lip-84','lip-314','lip-13','cheek-288','jaw-136','jaw-365','forehead-103','forehead-332']);

/** Use the face outline controls. */
export function defaultTemplate():Template{
 const template=structuredClone(original) as Template;
 return {...template,id:'face-controls',version:OUTLINE_LAYOUT_VERSION,name:'Face outline controls',points:template.points.filter(d=>!retiredDefaultIds.has(d.id)),contours:template.contours.filter(c=>c.name!=='Neck').map(c=>{
  if(c.name==='Left eye')return {name:'Left iris guides',ids:['p36','p35','p34'],closed:true};
  if(c.name==='Right eye')return {name:'Right iris guides',ids:['p37','p33','p32'],closed:true};
  return {...c,ids:c.ids.filter(id=>!retiredDefaultIds.has(id))};
 })};
}
export function pointLabel(id:string):string{return /^p\d+$/.test(id)?String(Number(id.slice(1))):id;}

/** A snapshot is usable only for the exact same photo coordinate system. */
function recoverySource(project:Project,source:Source):Source|undefined{
 return [...project.variants].sort((a,b)=>b.created-a.created).flatMap(v=>v.sources).find(s=>s.id===source.id&&s.width===source.width&&s.height===source.height&&s.originalAssetId===source.originalAssetId&&s.fitVersion===6&&JSON.stringify(s.featurePoints)===JSON.stringify(source.featurePoints));
}

/** Restore built-in correspondences once, keeping an exact undo/recovery copy. */
export function updateLayout(project:Project):Project{
 if(!project.template.points.length)return project;
 const defaults=defaultTemplate();
 const remove=new Set([...retiredDefaultIds].filter(id=>removedJunctions.has(id)||!project.recipe.pins[id]&&!project.sources.some(s=>s.landmarks.some(p=>p.id===id&&(p.authored||p.locked)))));
 if(project.template.version>=OUTLINE_LAYOUT_VERSION&&!project.template.points.some(p=>removedJunctions.has(p.id)))return project;
 const before=recoverySnapshot(project,'outline-11');
 const retained=project.template.points.filter(d=>!remove.has(d.id)&&!deprecatedPointIds.has(d.id)&&!defaults.points.some(p=>p.id===d.id));
 const points=[...defaults.points,...retained],available=new Set(points.map(d=>d.id));
 const contours=[...defaults.contours,...project.template.contours.filter(c=>c.ids.length>1&&c.ids.every(id=>retained.some(d=>d.id===id)))];
 const template:Template={...defaults,points,contours};
 const sources=project.sources.map(source=>{
  const existing=new Map(source.landmarks.map(p=>[p.id,p]));
  const recovery=recoverySource(project,source),recovered=new Map(recovery?.landmarks.map(p=>[p.id,p]));
  const current=source.featurePoints?.['mp-477']?calibration.map((_,i)=>({x:source.featurePoints?.[`mp-${i}`]?.[0]??NaN,y:source.featurePoints?.[`mp-${i}`]?.[1]??NaN})):undefined;
  const fit=current?fitLandmarks(template,current,calibration.map(p=>({x:p[0],y:p[1]})),source.width,source.height,undefined,source.analysisMasks):undefined;
  const fitted=new Map(fit?.landmarks.map(p=>[p.id,p]));
  const landmarks:Landmark[]=points.map(d=>{
   const p=existing.get(d.id);
   if(p&&(p.authored||p.locked||(!p.enabled&&!p.autoDisabled)||project.recipe.pins[d.id]))return p;
   return recovered.get(d.id)??fitted.get(d.id)??p??{id:d.id,x:d.reference[0],y:d.reference[1],enabled:false,locked:false,authored:false,confidence:.2,review:'No cached position. Place this control or detect landmarks.'};
  });
  return {...source,landmarks,fitVersion:recovery||fit?FIT_VERSION:source.fitVersion,observation:recovery?.observation??fit?.observation??source.observation,note:recovery?.note??fit?.note??source.note};
 });
 const {landmarkMode:legacyMode,...recipe}=project.recipe;void legacyMode;
 return withShapeControls({...project,variants:before?[...project.variants,before]:project.variants,template,sources,recipe:{...recipe,pins:Object.fromEntries(Object.entries(recipe.pins).filter(([id])=>available.has(id)))}});
}

/** Custom and intentionally cleared layouts remain under the user's control. */
export function refreshDefaultLayout(project:Project):Project{
 return project.template.points.length&&(project.template.id==='face-controls'||project.template.id===original.id)&&project.template.version<OUTLINE_LAYOUT_VERSION?updateLayout(project):project;
}

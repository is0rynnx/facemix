import {recoverySnapshot} from './variants';
import calibration from './detector-calibration.json';
import type {Landmark,PointDefinition,Project,Source,Vec} from './types';
import {sampleMask} from './engine/contour-evidence';

export const measuredDetailDefinitions:PointDefinition[]=[
 ['lid-159','Left upper eyelid center','eyes',159,'lid-386'],['lid-145','Left lower eyelid center','eyes',145,'lid-374'],
 ['lid-386','Right upper eyelid center','eyes',386,'lid-159'],['lid-374','Right lower eyelid center','eyes',374,'lid-145'],
 ['lid-160','Left upper eyelid outer','eyes',160,'lid-387'],['lid-158','Left upper eyelid inner','eyes',158,'lid-385'],
 ['lid-385','Right upper eyelid inner','eyes',385,'lid-158'],['lid-387','Right upper eyelid outer','eyes',387,'lid-160'],
 ['lip-0','Upper lip center','mouth',0,undefined],['lip-84','Left lower lip curve','mouth',84,'lip-314'],['lip-314','Right lower lip curve','mouth',314,'lip-84'],['lip-13','Lip seam center','mouth',13,undefined]
].map(([id,name,region,index,mirror])=>({id,name,region,detectorIndex:index,reference:calibration[index as number],...(mirror?{mirror}:{})})) as PointDefinition[];

function measurement(source:Source,def:PointDefinition):Vec|undefined{
 const p=source.featurePoints?.['mp-'+def.detectorIndex];if(!p||p.some(v=>!Number.isFinite(v)||v<0||v>1))return;
 const masks=source.analysisMasks;
 if(masks?.face&&(sampleMask(masks.face,...p)<.55||Math.max(sampleMask(masks.hair,...p),sampleMask(masks.clothing,...p),sampleMask(masks.accessories,...p))>.4))return;
 if(def.region==='eyes'){
  const right=(def.detectorIndex??0)>=362,a=source.featurePoints?.['mp-'+(right?362:33)],b=source.featurePoints?.['mp-'+(right?263:133)],upper=source.featurePoints?.['mp-'+(right?386:159)],lower=source.featurePoints?.['mp-'+(right?374:145)];
  if(!a||!b||!upper||!lower)return;
  const span=Math.hypot((a[0]-b[0])*source.width,(a[1]-b[1])*source.height),gap=Math.hypot((upper[0]-lower[0])*source.width,(upper[1]-lower[1])*source.height);
  if(span<8||gap<Math.max(1,span*.025)||gap>span*.7)return;
 }
 return p;
}
const contains=(p:Vec,polygon:Vec[])=>{let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};

/** Add only native image observations, never transfer guesses into new controls. */
export function withMeasuredDetail(project:Project):Project{
 if(project.template.id!=='face-controls'||!project.template.points.length||!project.sources.length||project.sources.some(s=>s.status==='preparing'))return project;
 const groups=[['lid-160','lid-159','lid-158','lid-145'],['lid-385','lid-386','lid-387','lid-374'],['lip-0','lip-84','lip-314','lip-13']];
 const eligible=new Set(groups.filter(ids=>project.sources.every(s=>ids.every(id=>measurement(s,measuredDetailDefinitions.find(d=>d.id===id)!)))).flat());
 const missing=measuredDetailDefinitions.filter(d=>!project.template.points.some(p=>p.id===d.id)&&eligible.has(d.id));
 const definitions=[...project.template.points,...missing],hasDetail=definitions.some(d=>measuredDetailDefinitions.some(p=>p.id===d.id));if(!hasDetail)return project;
 const sources=project.sources.map(source=>{
  const points=new Map(source.landmarks.map(p=>[p.id,p]));
  for(const def of measuredDetailDefinitions){if(!definitions.some(d=>d.id===def.id))continue;const current=points.get(def.id);if(current&&(current.authored||current.locked||(!current.enabled&&!current.autoDisabled)||project.recipe.pins[def.id]))continue;
   const group=groups.find(ids=>ids.includes(def.id))!,supported=group.every(id=>measurement(source,measuredDetailDefinitions.find(d=>d.id===id)!));
   const p=supported?measurement(source,def):undefined;if(p)points.set(def.id,{id:def.id,x:p[0],y:p[1],enabled:true,locked:false,authored:false,confidence:.8});
   else if(current)points.set(def.id,{...current,enabled:false,autoDisabled:true,confidence:.3,review:'Feature is too small or covered. Place this control manually to use it.'});
  }
  // A synthetic iris guide outside the visible opening cannot constrain that eye safely.
  for(const [rim,iris]of [[['p04','lid-160','lid-159','lid-158','p01','lid-145'],['p30','p34','p35','p36']],[['p02','lid-385','lid-386','lid-387','p03','lid-374'],['p31','p32','p33','p37']]]){
   const opening=rim.map(id=>points.get(id));if(opening.some(p=>!p?.enabled))continue;const polygon=opening.map(p=>[p!.x,p!.y] as Vec);
   for(const id of iris){const p=points.get(id);if(!p||p.authored||p.locked||!p.enabled||project.recipe.pins[id])continue;if(!contains([p.x,p.y],polygon))points.set(id,{...p,enabled:false,autoDisabled:true,confidence:.3,review:'Iris guide lies outside the eyelid opening. Excluded until reviewed.'});}
  }
  return {...source,landmarks:definitions.map(d=>points.get(d.id)).filter((p):p is Landmark=>!!p)};
 });
 const available=new Set(definitions.map(d=>d.id)),contours=project.template.contours.filter(c=>!['Left eyelid','Right eyelid','Lip seam'].includes(c.name));
 for(const [name,ids,closed]of [['Left eyelid',['p04','lid-160','lid-159','lid-158','p01','lid-145'],true],['Right eyelid',['p02','lid-385','lid-386','lid-387','p03','lid-374'],true],['Lip seam',['p16','lip-13','p17'],false]] as const)if(ids.every(id=>available.has(id)))contours.push({name,ids:[...ids],closed});
 const mouth=['p16','p38','lip-0','p39','p17','lip-314','p40','lip-84'].filter(id=>available.has(id));if(missing.some(d=>d.region==='mouth')){const i=contours.findIndex(c=>c.name==='Mouth');if(i>=0)contours[i]={name:'Mouth',ids:mouth,closed:true};}
 if(!missing.length&&project.template.version>=13&&JSON.stringify(contours)===JSON.stringify(project.template.contours)&&sources.every((s,i)=>JSON.stringify(s.landmarks)===JSON.stringify(project.sources[i].landmarks)))return project;
 const before=missing.length&&project.template.version<13?recoverySnapshot(project,'detail-13'):undefined;
 return {...project,template:{...project.template,version:Math.max(13,project.template.version),points:definitions,contours},sources,variants:before?[...project.variants,before]:project.variants};
}

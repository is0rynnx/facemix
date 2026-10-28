import detail from './feature-template.json';
import reference from './reference-template.json';
import calibration from './detector-calibration.json';
import {headMaskFromAnalysis} from './engine/head-evidence';
import {recoverySnapshot} from './variants';
import {point,transfer,fitLandmarks,FIT_VERSION,semanticPoint} from './engine/fitting';

import {applyBasis,mlsBasis,buildControls,signedArea,avoidFoldedTriangles} from './engine/math';

import Delaunator from 'delaunator';

import type {Mask,PointDefinition,Project,Source,Template,Vec} from './types';

export const featureDefinitions=detail.points as PointDefinition[];

/** Keep manual points when the control layout changes. */
export function upgradeLandmarks(project:Project):Project{
 const legacy=project.template.version===3&&project.template.points.some(d=>d.id==='mp-159'),automaticPupils=project.template.version===4;
 if(!legacy&&!automaticPupils)return withShapeControls({...project,sources:project.sources.map(s=>fitUnreviewed(s,project.template,project.recipe.pins))});
 const old=new Set(legacy?['mp-159','mp-386','mp-81','mp-13','mp-311','mp-402','mp-14','mp-178','mp-136','mp-148','mp-365','mp-377']:featureDefinitions.map(d=>d.id));
 const removable=new Set([...old].filter(id=>!project.recipe.pins[id]&&project.sources.every(s=>!s.landmarks.some(p=>p.id===id&&(p.authored||p.locked)))));
 const template={...project.template,version:5,name:'61-point layout',points:project.template.points.filter(d=>!removable.has(d.id)).map(d=>{const ref=reference.points.find(r=>r.id===d.id);return ref&&['Right iris left edge','Right iris right edge','Left iris left edge','Left iris right edge'].includes(d.name)?{...d,name:ref.name}:d;}),contours:project.template.contours.map(c=>({...c,ids:c.ids.filter(id=>!removable.has(id))})).filter(c=>c.ids.length>1)} as Template;
 return withShapeControls({...project,template,sources:project.sources.map(s=>({...s,landmarks:s.landmarks.filter(p=>!removable.has(p.id))})).map(s=>fitUnreviewed(s,template))});
}

export function withFeatureControls(project:Project):Project{

 const missing=featureDefinitions.filter(d=>!project.template.points.some(p=>p.id===d.id)&&!(d.detectorIndex===468&&project.template.points.some(p=>p.id==='p30'))&&!(d.detectorIndex===473&&project.template.points.some(p=>p.id==='p31')));if(!missing.length)return project;

 const template:Template={...project.template,version:6,name:project.template.name+' + iris guides',points:[...project.template.points,...missing],contours:project.template.contours};

 const sources=project.sources.map(s=>{

  const defs=project.template.points.filter(d=>s.landmarks.some(p=>p.id===d.id&&p.enabled));

  const q=defs.map(d=>[d.reference[0]*.8,d.reference[1]] as Vec),uv=defs.map(d=>{const p=s.landmarks.find(p=>p.id===d.id)!;return [p.x,p.y] as Vec;});

  return {...s,landmarks:[...s.landmarks,...missing.map(d=>{const exact=s.featurePoints?.[d.id]??s.featurePoints?.[`mp-${d.detectorIndex}`],p=exact??applyBasis(mlsBasis(q,[d.reference[0]*.8,d.reference[1]]),uv);return {id:d.id,x:p[0],y:p[1],enabled:true,locked:false,authored:false,confidence:exact?.93:.35};})]};

 });return reviewAutoGuides({...project,template,sources});

}

/** Disable only unreviewed supplemental guides, visibly in the project, when

 * they introduce folds. Authored/locked controls are never altered. This is

 * run during automatic preparation, never secretly while rendering edits. */

export function reviewAutoGuides(project:Project):Project{

 if(!project.recipe||project.sources.filter(s=>s.enabled).length<2)return project;

 const folds=(p:Project)=>{const c=buildControls({revision:p.revision,sources:p.sources,template:p.template,recipe:p.recipe,size:512,quality:'preview'});if(c.q.length<3)return 0;const minX=Math.min(0,...c.q.map(p=>p[0])),maxX=Math.max(p.recipe.aspect,...c.q.map(p=>p[0])),minY=Math.min(0,...c.q.map(p=>p[1])),maxY=Math.max(1,...c.q.map(p=>p[1])),pad=Math.max(maxX-minX,maxY-minY)*2,outer:Vec[]=[[minX-pad,minY-pad],[maxX+pad,minY-pad],[maxX+pad,maxY+pad],[minX-pad,maxY+pad]],q=[...c.q,...outer],uv=c.uv.map(ps=>[...ps,...outer.map(v=>applyBasis(mlsBasis(c.q,v),ps))]),triangles=avoidFoldedTriangles(q,uv,Delaunator.from(q).triangles,c.q.length);let count=0;for(let s=0;s<c.sources.length;s++)for(let t=0;t<triangles.length;t+=3){const[a,b,d]=[triangles[t],triangles[t+1],triangles[t+2]];if(signedArea(q[a],q[b],q[d])*signedArea(uv[s][a],uv[s][b],uv[s][d])< -1e-13)count++;}return count;};

 let current=project,score=folds(project);if(!score)return project;const skipped:string[]=[];

 for(let round=0;round<featureDefinitions.length;round++){let best=current,bestScore=score,bestId='';

  for(const def of featureDefinitions){if(skipped.includes(def.id)||current.recipe.pins[def.id]||current.sources.some(s=>{const p=s.landmarks.find(p=>p.id===def.id);return p?.authored||p?.locked;})||!current.sources.every(s=>s.landmarks.some(p=>p.id===def.id&&p.enabled)))continue;

   const candidate={...current,sources:current.sources.map(s=>({...s,landmarks:s.landmarks.map(p=>p.id===def.id?{...p,enabled:false,confidence:.25}:p)}))},candidateScore=folds(candidate);if(candidateScore<bestScore){best=candidate;bestScore=candidateScore;bestId=def.id;}

  }if(!bestId)break;skipped.push(bestId);current=best;score=bestScore;if(!score)break;

 }

 return skipped.length?{...current,sources:current.sources.map(s=>({...s,note:`${s.note??''} ${skipped.length} iris guides disabled. Check their positions in Points.`.trim()}))}:project;

}

export function mirrorMask(mask:Mask|undefined):Mask|undefined{if(!mask)return;const data=new Uint8Array(mask.data.length);for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)data[y*mask.width+x]=mask.data[y*mask.width+mask.width-1-x];return {...mask,data};}

export function compatibility(sources:Source[]):string[]{

 const active=sources.filter(s=>s.enabled),known=active.map(s=>s.observation).filter(Boolean) as NonNullable<Source['observation']>[];const notes:string[]=[];

 if(known.length>1){const openings=known.map(v=>v.mouthOpen);if(Math.max(...openings)-Math.min(...openings)>.10)notes.push('Mouth openings differ. Check the mouth points or select a mouth source.');

  const turns=known.map(v=>v.turn);if(Math.max(...turns)-Math.min(...turns)>.32)notes.push('Face directions differ. Check the far eye and jaw.');

  if(known.some(v=>Math.abs(v.turn)>.38))notes.push('Check the far eye and jaw on the turned source.');}

 return notes;

}

export function fitUnreviewed(s:Source,template:Template,pins:Record<string,Vec>={}):Source{
 if((s.fitVersion??0)>=FIT_VERSION||!s.featurePoints||!s.featurePoints['mp-477'])return s;
 const r=calibration.map(p=>({x:p[0],y:p[1]})),current=calibration.map((_,i)=>({x:s.featurePoints![`mp-${i}`]?.[0]??NaN,y:s.featurePoints![`mp-${i}`]?.[1]??NaN})),fit=fitLandmarks(template,current,r,s.width,s.height,headMaskFromAnalysis(s.analysisMasks)??s.subjectMask,s.analysisMasks),incoming=new Map(fit.landmarks.map(p=>[p.id,p]));
 return {...s,fitVersion:FIT_VERSION,observation:fit.observation,note:fit.note,landmarks:s.landmarks.map(p=>p.authored||p.locked||(!p.enabled&&!p.autoDisabled)||pins[p.id]?p:incoming.get(p.id)??p)};
}

/** Apply a fitting correction once to the current built-in layout. Saved
 * variants, authored coordinates, disabled controls and output pins stay intact. */
export function refreshAutomaticFit(project:Project):Project{
 if(!project.template.points.length||![reference.id,'face-controls'].includes(project.template.id))return project;
 const sources=project.sources.map(source=>source.landmarks.some(p=>!p.authored&&!p.locked&&(p.enabled||p.autoDisabled)&&!project.recipe.pins[p.id])?fitUnreviewed(source,project.template,project.recipe.pins):source);
 if(sources.every((source,i)=>source===project.sources[i]))return project;
 const backup=recoverySnapshot(project,`fit-${FIT_VERSION}`,`Landmark backup ${FIT_VERSION}`);
 return {...project,sources,variants:backup?[...project.variants,backup]:project.variants};
}

/** Shape guides are visible correspondences. They are added only for an edited feature. */
const eyeIndices=[159,145,386,374,160,158,144,153,385,387,380,373];
const lipIndices=[0,17,37,267,84,314,13,14,82,312,87,317];
const noseIndices=[48,278,97,326];
const jawIndices=[136,150,149,176,400,379,378,365,93,323];
const paired:Record<number,number>={159:386,386:159,145:374,374:145,160:387,387:160,158:385,385:158,144:373,373:144,153:380,380:153,0:0,17:17,37:267,267:37,84:314,314:84,13:13,14:14,82:312,312:82,87:317,317:87,48:278,278:48,97:326,326:97,136:365,365:136,150:379,379:150,149:378,378:149,176:400,400:176,93:323,323:93};
const guideNames:Record<number,string>={159:'Left upper eyelid center',145:'Left lower eyelid center',386:'Right upper eyelid center',374:'Right lower eyelid center',160:'Left upper eyelid outer',158:'Left upper eyelid inner',144:'Left lower eyelid outer',153:'Left lower eyelid inner',385:'Right upper eyelid inner',387:'Right upper eyelid outer',380:'Right lower eyelid inner',373:'Right lower eyelid outer',0:'Upper lip center',17:'Lower lip center',37:'Left upper lip',267:'Right upper lip',84:'Left lower lip',314:'Right lower lip',13:'Upper inner lip center',14:'Lower inner lip center',82:'Left upper inner lip',312:'Right upper inner lip',87:'Left lower inner lip',317:'Right lower inner lip'};
function guideDefinitions(indices:number[],prefix:string,region:PointDefinition['region']):PointDefinition[]{return indices.map((n,i)=>({id:prefix+'-'+n,name:guideNames[n]??`${calibration[n][0]<.5?'Left':'Right'} ${prefix==='ala'?'nose rim':'jaw contour'} ${Math.floor(i/2)+1}`,region,reference:calibration[n] as Vec,detectorIndex:n,mirror:prefix+'-'+paired[n]}));}
function addShapeGuides(project:Project,defs:PointDefinition[]):Project{
 if(!project.template.points.length)return project;
 const missing=defs.filter(d=>!project.template.points.some(p=>p.id===d.id)),allDefs=[...project.template.points,...missing];if(!missing.length&&project.sources.every(s=>allDefs.every(d=>s.landmarks.some(p=>p.id===d.id))))return project;
 const sources=project.sources.map(s=>{
  const needed=allDefs.filter(d=>!s.landmarks.some(p=>p.id===d.id));if(!needed.length)return s;
  const enabled=project.template.points.filter(d=>s.landmarks.some(p=>p.id===d.id&&p.enabled));
  const current=s.featurePoints?.['mp-477']?calibration.map((_,i)=>({x:s.featurePoints![`mp-${i}`][0],y:s.featurePoints![`mp-${i}`][1]})):undefined,ref=calibration.map(p=>({x:p[0],y:p[1]})),metric=s.width/s.height;
  const q=enabled.map(d=>{const p=current?(s.fitVersion===FIT_VERSION?semanticPoint(d,current,ref,metric):point(d,current,ref,project.template,(p,c)=>transfer(ref,c,p))):d.reference;return [p[0]*(current?metric:.8),p[1]] as Vec;}),uv=enabled.map(d=>{const p=s.landmarks.find(p=>p.id===d.id)!;return [p.x,p.y] as Vec;});
  return {...s,landmarks:[...s.landmarks,...needed.map(d=>{const exact=d.detectorIndex!==undefined?s.featurePoints?.['mp-'+d.detectorIndex]:undefined,position=exact??(current?point(d,current,ref,project.template,(p,c)=>transfer(ref,c,p)):d.reference),p=q.length?applyBasis(mlsBasis(q,[position[0]*(current?metric:.8),position[1]]),uv):position;return {id:d.id,x:p[0],y:p[1],enabled:true,locked:false,authored:false,confidence:exact?.9:.4};})]};
 });
 return {...project,template:{...project.template,version:Math.max(8,project.template.version),points:allDefs},sources};
}
export function withEyelidControls(project:Project):Project{return addShapeGuides(project,guideDefinitions(eyeIndices.slice(0,4),'lid','eyes'));}
function mouthIsOpen(source:Source):boolean{const p=source.featurePoints,a=p?.['mp-13'],b=p?.['mp-14'],l=p?.['mp-61'],r=p?.['mp-291'];if(!a||!b||!l||!r)return false;const metric=source.width/source.height;return Math.hypot((a[0]-b[0])*metric,a[1]-b[1])/Math.max(.0001,Math.hypot((l[0]-r[0])*metric,l[1]-r[1]))>.04;}
export function withShapeControls(project:Project):Project{
 const e=project.recipe.faceEdits??{},used=(keys:string[])=>keys.some(k=>!!e[k as keyof typeof e]);const defs:PointDefinition[]=[];
 if(used(['eyeSize','eyeHeight','eyeWidth','eyeTilt','eyeVertical']))defs.push(...guideDefinitions(eyeIndices,'lid','eyes'));
 if(used(['noseWidth','noseLength','nostrilWidth']))defs.push(...guideDefinitions(noseIndices,'ala','nose'));
 const innerVisible=project.sources.filter(s=>s.enabled).every(mouthIsOpen);
 if(used(['mouthWidth','lipHeight','upperLipHeight','lowerLipHeight','mouthVertical','smile']))defs.push(...guideDefinitions(innerVisible?lipIndices:[...lipIndices.slice(0,6),13],'lip','mouth'));
 const interior=new Set(['lip-14','lip-82','lip-312','lip-87','lip-317']);if(project.template.points.some(d=>interior.has(d.id)))project={...project,sources:project.sources.map(s=>({...s,landmarks:s.landmarks.map(p=>interior.has(p.id)&&!p.authored&&!p.locked&&!project.recipe.pins[p.id]?{...p,enabled:innerVisible&&p.enabled}:p)}))};
 if(used(['faceWidth','jawWidth','chinHeight','chinWidth','cheekWidth']))defs.push(...guideDefinitions(jawIndices,'jaw','outline'));
 const sharedLipAliases=new Set(['lip-17','lip-37','lip-267']),semanticSources=project.template.id==='face-controls'&&project.sources.every(s=>s.fitVersion===FIT_VERSION);
 return addShapeGuides(project,semanticSources?defs.filter(d=>!sharedLipAliases.has(d.id)):defs);
}

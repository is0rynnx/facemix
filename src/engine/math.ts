import Delaunator from 'delaunator';
import {usesControl} from '../landmark-policy';

import {editFaceShape} from './face-edits';

import { REGIONS,type Diagnostic,type Landmark,type Project,type Recipe,type Region,type RenderSpec,type Source,type Template,type Vec } from '../types';

export function normalize(values:number[]):number[]{

  const clean=values.map(v=>Number.isFinite(v)?Math.max(0,v):0);const sum=clean.reduce((a,b)=>a+b,0);

  return sum>0?clean.map(v=>v/sum):clean.map(()=>0);

}

export const regionOf=(template:Template,id:string):Region=>template.points.find(p=>p.id===id)?.region??'outline';

export function regionalInfluence(sources:Source[],region:Region,channel:'shape'|'appearance',recipe:Recipe):number[]{

 const donor=recipe.regionSources?.[region]?.[channel];

 return donor?sources.map(s=>s.id===donor?1:0):normalize(sources.map(s=>(channel==='shape'?s.shapeWeight:s.appearanceWeight)*(s.regionWeights[region]?.[channel]??1)));

}

export function sourceAlignment(source:Source,aspect:number,frameScale=.9,frameOffsetY=.02):{forward:(p:Vec)=>Vec;inverse:(p:Vec)=>Vec}{

  const byId=new Map(source.landmarks.map(p=>[p.id,p]));
  // Clearing editable controls must not discard the photo's measured eye frame.
  // A partial pair is insufficient: combining one edited eye with a generic
  // fallback changes the camera frame as the user builds a manual outline.
  const ids=['p01','p04','p02','p03'],native=[133,33,362,263];
  const manual=ids.map(id=>byId.get(id)),cached=native.map(id=>source.featurePoints?.['mp-'+id]);
  const eyes:Vec[]|undefined=manual.every(p=>p?.enabled&&Number.isFinite(p.x)&&Number.isFinite(p.y))?manual.map(p=>[p!.x,p!.y]):cached.every(p=>p&&p.every(Number.isFinite))?cached as Vec[]:undefined;
  if(!eyes){const k=Math.min(aspect/source.width,1/source.height)*frameScale;return {forward:([x,y])=>[aspect/2+(x-.5)*source.width*k,.5+frameOffsetY+(y-.5)*source.height*k],inverse:([x,y])=>[(x-aspect/2)/k/source.width+.5,(y-.5-frameOffsetY)/k/source.height+.5]};}
  const avg=(a:Vec,b:Vec):Vec=>[(a[0]+b[0])*source.width/2,(a[1]+b[1])*source.height/2];
  const l=avg(eyes[0],eyes[1]),r=avg(eyes[2],eyes[3]);

  const dx=r[0]-l[0],dy=r[1]-l[1],length=Math.max(1,Math.hypot(dx,dy));

  const a=dx/length,b=dy/length,k=.25*aspect/length*frameScale,cx=(l[0]+r[0])/2,cy=(l[1]+r[1])/2,eyeY=.4+frameOffsetY;

  return {forward:([x,y])=>{const u=x*source.width-cx,v=y*source.height-cy;return [.5*aspect+k*(a*u+b*v),eyeY+k*(-b*u+a*v)];},inverse:([x,y])=>{const u=(x-.5*aspect)/k,v=(y-eyeY)/k;return [(cx+a*u-b*v)/source.width,(cy+b*u+a*v)/source.height];}};

}

/** Transfer one new correspondence through the two photos' cached face meshes.
 * The click stays exact in its own photo. Existing edited correspondences add
 * local corrections; zero, one or two controls cannot collapse the transfer. */
export function transferPoint(from:Source,to:Source,p:Vec):Vec{
 const metric=from.width/from.height,targetMetric=to.width/to.height;
 const common=from.landmarks.filter(a=>a.enabled&&Number.isFinite(a.x)&&Number.isFinite(a.y)).flatMap(a=>{const b=to.landmarks.find(b=>b.id===a.id&&b.enabled);return b&&Number.isFinite(b.x)&&Number.isFinite(b.y)?[{a:[a.x*metric,a.y] as Vec,b:[b.x*targetMetric,b.y] as Vec}]:[];});
 const native=Object.entries(from.featurePoints??{}).filter(([id])=>/^mp-\d+$/.test(id)&&Number(id.slice(3))<468).flatMap(([id,a])=>{const b=to.featurePoints?.[id];return b&&[...a,...b].every(Number.isFinite)?[{a:[a[0]*metric,a[1]] as Vec,b:[b[0]*targetMetric,b[1]] as Vec}]:[];});
 const query:Vec=[p[0]*metric,p[1]];
 const nativeDomain=native.map(pair=>pair.a),nativeValues=native.map(pair=>pair.b),nativeTriangles=native.length>=3?Delaunator.from(nativeDomain).triangles:[];
 const mapNative=(v:Vec):Vec=>{
  const q=nativeDomain,uv=nativeValues,triangles=nativeTriangles;
  for(let i=0;i<triangles.length;i+=3){const a=triangles[i],b=triangles[i+1],c=triangles[i+2];if(Math.abs(signedArea(q[a],q[b],q[c]))<1e-12)continue;const weights=barycentric(v,q[a],q[b],q[c]) as unknown as number[];if(weights.every(w=>w>=-1e-8))return [0,1].map(k=>weights[0]*uv[a][k]+weights[1]*uv[b][k]+weights[2]*uv[c][k]) as Vec;}
  return applyBasis(mlsBasis(q,v),uv);
 };
 if(nativeTriangles.length&&spansPlane(nativeDomain)&&spansPlane(nativeValues)){
  const base=mapNative(query);let x=0,y=0,sum=0;
  for(const pair of common){const d=(query[0]-pair.a[0])**2+(query[1]-pair.a[1])**2;if(d<1e-18)return [pair.b[0]/targetMetric,pair.b[1]];const predicted=mapNative(pair.a),w=1/d;x+=(pair.b[0]-predicted[0])*w;y+=(pair.b[1]-predicted[1])*w;sum+=w;}
  return [(base[0]+(sum?x/sum:0))/targetMetric,base[1]+(sum?y/sum:0)];
 }
 if(spansPlane(common.map(pair=>pair.a))&&spansPlane(common.map(pair=>pair.b))){const xy=applyBasis(mlsBasis(common.map(pair=>pair.a),query),common.map(pair=>pair.b));return [xy[0]/targetMetric,xy[1]];}
 if(common.length>=2){const a=common[0],b=common.find(pair=>Math.hypot(pair.a[0]-a.a[0],pair.a[1]-a.a[1])>1e-7);if(b){const dx=b.a[0]-a.a[0],dy=b.a[1]-a.a[1],u=b.b[0]-a.b[0],v=b.b[1]-a.b[1],den=dx*dx+dy*dy,c=(dx*u+dy*v)/den,s=(dx*v-dy*u)/den,x=query[0]-a.a[0],y=query[1]-a.a[1];return [(a.b[0]+c*x-s*y)/targetMetric,a.b[1]+s*x+c*y];}}
 const start=sourceAlignment(from,.8),end=sourceAlignment(to,.8),base=end.inverse(start.forward(p));
 if(common.length){const pair=common[0],anchor=end.inverse(start.forward([pair.a[0]/metric,pair.a[1]]));return [base[0]+pair.b[0]/targetMetric-anchor[0],base[1]+pair.b[1]-anchor[1]];}
 return base;
}

export interface Controls { q:Vec[]; uv:Vec[][]; ids:string[]; sources:Source[]; diagnostics:Diagnostic[]; }

/** Shape inputs only. View gestures, masks and appearance do not change cells. */
export function geometrySignature(spec:Pick<RenderSpec,'sources'|'template'|'recipe'>):string{
 const r=spec.recipe;return JSON.stringify([r.aspect,r.frameScale,r.frameOffsetY,r.warp,r.earControls,r.hairControls,r.pins,r.faceEdits,r.frameAnchors,r.regionSources&&Object.entries(r.regionSources).filter(([,v])=>v.shape).map(([region,v])=>[region,v.shape]),spec.template.id,spec.template.points.map(p=>[p.id,p.region]),spec.sources.filter(s=>s.enabled).slice().sort((a,b)=>a.id.localeCompare(b.id)).map(s=>[s.id,s.width,s.height,s.fitVersion,[133,33,362,263].map(i=>s.featurePoints?.['mp-'+i]),s.shapeWeight,s.landmarks.map(p=>[p.id,p.x,p.y,p.enabled]),REGIONS.map(r=>s.regionWeights[r]?.shape??1)])]);
}

export function buildControls(spec:RenderSpec):Controls{

  const sources=spec.sources.filter(s=>s.enabled).slice().sort((a,b)=>a.id.localeCompare(b.id));

  const align=sources.map(s=>sourceAlignment(s,spec.recipe.aspect,spec.recipe.frameScale,spec.recipe.frameOffsetY));const maps=sources.map(s=>new Map(s.landmarks.map(p=>[p.id,p])));

  const q:Vec[]=[],uv:Vec[][]=sources.map(()=>[]),ids:string[]=[],diagnostics:Diagnostic[]=[];

  for(const def of spec.template.points){

    if(!usesControl(def,spec.recipe))continue;

    const ps=maps.map(m=>m.get(def.id));if(ps.some(p=>!p||!p.enabled))continue;

    const weights=regionalInfluence(sources,def.region,'shape',spec.recipe);

    if(!weights.some(w=>w>0)){diagnostics.push({kind:'error',message:`${def.region}: all shape influences are zero.`});continue;}

    const positions=ps.map((p,i)=>align[i].forward([p!.x,p!.y]));

    let target:Vec=[positions.reduce((s,p,i)=>s+p[0]*weights[i],0),positions.reduce((s,p,i)=>s+p[1]*weights[i],0)];

    const duplicate=q.findIndex(p=>Math.hypot(p[0]-target[0],p[1]-target[1])<1e-7);

    if(duplicate>=0){

      const conflict=ps.some((p,i)=>Math.hypot(p!.x-uv[i][duplicate][0],p!.y-uv[i][duplicate][1])>1e-5);

      if(conflict)diagnostics.push({kind:'error',code:'coincident-controls',pointIds:[ids[duplicate],def.id],message:`${def.name}: coincident output controls have conflicting correspondences.`,position:[target[0]/spec.recipe.aspect,target[1]]});

      continue;

    }

    q.push(target);ids.push(def.id);ps.forEach((p,i)=>uv[i].push([p!.x,p!.y]));

  }

  const edited=editFaceShape(ids,q,spec.recipe);

  for(let i=0;i<q.length;i++)q[i]=spec.recipe.pins[ids[i]]?[spec.recipe.pins[ids[i]][0]*spec.recipe.aspect,spec.recipe.pins[ids[i]][1]]:edited[i];

  for(let i=0;i<q.length;i++)for(let j=0;j<i;j++)if(Math.hypot(q[i][0]-q[j][0],q[i][1]-q[j][1])<1e-7)diagnostics.push({kind:'error',code:'overlapping-controls',pointIds:[ids[j],ids[i]],message:'Output shape controls overlap. Reset or move the selected controls.',position:[q[i][0]/spec.recipe.aspect,q[i][1]]});

  if(spec.recipe.frameAnchors){

    const border:Vec[]=[];for(let i=0;i<16;i++){const t=i/16;border.push([t,0],[1,t],[1-t,1],[0,1-t]);}

    for(const [i,p] of border.entries()){

      const v:Vec=[p[0]*spec.recipe.aspect,p[1]],existing=q.findIndex(q=>Math.hypot(q[0]-v[0],q[1]-v[1])<1e-7);

      if(existing>=0){if(align.some((a,j)=>{const u=a.inverse(v);return Math.hypot(u[0]-uv[j][existing][0],u[1]-uv[j][existing][1])>1e-5;}))diagnostics.push({kind:'error',message:'A control conflicts with the pinned border.',position:p});continue;}

      q.push(v);ids.push(`frame${i}`);align.forEach((a,j)=>uv[j].push(a.inverse(v)));

    }

  }


  return {q,uv,ids,sources,diagnostics};

}

/** Affine MLS expressed as reusable scalar basis coefficients. Exact at each handle. */

export function mlsBasis(q:Vec[],v:Vec):Float64Array{

  const n=q.length,result=new Float64Array(n),w=new Float64Array(n);let sum=0,cx=0,cy=0;

  for(let i=0;i<n;i++){const d=(q[i][0]-v[0])**2+(q[i][1]-v[1])**2;if(d<1e-18){result[i]=1;return result;}w[i]=1/d;sum+=w[i];cx+=w[i]*q[i][0];cy+=w[i]*q[i][1];}

  cx/=sum;cy/=sum;let xx=0,xy=0,yy=0;

  for(let i=0;i<n;i++){const x=q[i][0]-cx,y=q[i][1]-cy;xx+=w[i]*x*x;xy+=w[i]*x*y;yy+=w[i]*y*y;}

  const det=xx*yy-xy*xy;

  if(Math.abs(det)<1e-16){for(let i=0;i<n;i++)result[i]=w[i]/sum;return result;}

  const dx=v[0]-cx,dy=v[1]-cy,ax=(dx*yy-dy*xy)/det,ay=(dy*xx-dx*xy)/det;

  for(let i=0;i<n;i++)result[i]=w[i]/sum+w[i]*(ax*(q[i][0]-cx)+ay*(q[i][1]-cy));

  return result;

}

export function applyBasis(basis:ArrayLike<number>,points:Vec[]):Vec{let x=0,y=0;for(let i=0;i<points.length;i++){x+=basis[i]*points[i][0];y+=basis[i]*points[i][1];}return [x,y];}

export function signedArea(a:Vec,b:Vec,c:Vec){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}

/** Reject line-like point sets before affine extrapolation can magnify noise. */
function spansPlane(points:Vec[]):boolean{
 if(points.length<3)return false;
 const triangles=Delaunator.from(points).triangles,extent=Math.max(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))),minimum=Math.max(1e-10,extent*extent*1e-4);
 for(let i=0;i<triangles.length;i+=3)if(Math.abs(signedArea(points[triangles[i]],points[triangles[i+1]],points[triangles[i+2]]))>minimum)return true;
 return false;
}

export function barycentric(p:Vec,a:Vec,b:Vec,c:Vec):Vec & {2?:number}{const den=signedArea(a,b,c);if(Math.abs(den)<1e-14)return [1,0,0] as unknown as Vec;const u=signedArea(p,b,c)/den,v=signedArea(a,p,c)/den;return [u,v,1-u-v] as unknown as Vec;}

export function triangleMapper(q:Vec[],points:Vec[]):(v:Vec)=>Vec{

  // Extend the sampling domain with values evaluated from the same authored

  // controls. These are samples of the field, not independent hidden pins.

  const minX=Math.min(0,...q.map(p=>p[0])),maxX=Math.max(1,...q.map(p=>p[0])),minY=Math.min(0,...q.map(p=>p[1])),maxY=Math.max(1,...q.map(p=>p[1])),pad=Math.max(maxX-minX,maxY-minY)*2;

  const outer:Vec[]=[[minX-pad,minY-pad],[maxX+pad,minY-pad],[maxX+pad,maxY+pad],[minX-pad,maxY+pad]];

  const values=[...points,...outer.map(v=>applyBasis(mlsBasis(q,v),points))],domain=[...q,...outer];

  const triangles=Delaunator.from(domain).triangles;

  return v=>{let best:number[]|undefined,bestB:number[]|undefined,penalty=Infinity;

    for(let i=0;i<triangles.length;i+=3){const ids=[triangles[i],triangles[i+1],triangles[i+2]],b=Array.from(barycentric(v,domain[ids[0]],domain[ids[1]],domain[ids[2]])) as number[];const p=b.reduce((s,x)=>s+Math.max(0,-x),0);if(p<penalty){penalty=p;best=ids;bestB=b;}if(p<1e-9)break;}

    if(!best||!bestB)return v;return [best.reduce((s,id,i)=>s+values[id][0]*bestB![i],0),best.reduce((s,id,i)=>s+values[id][1]*bestB![i],0)];};

}

export interface WarpMesh { vertices:Vec[]; triangles:Uint32Array; uvs:Vec[][]; controls:Controls; maxError:number; }

/** Choose compatible diagonals without moving any correspondence. */

function triangleHasArea(points:Vec[],ids:number[]):boolean{const[a,b,c]=ids.map(i=>points[i]),scale=Math.max((a[0]-b[0])**2+(a[1]-b[1])**2,(b[0]-c[0])**2+(b[1]-c[1])**2,(c[0]-a[0])**2+(c[1]-a[1])**2);return scale>0&&Math.abs(signedArea(a,b,c))>scale*1e-7;}
function segmentsMeet(ps:Vec[],a:number,b:number,c:number,d:number):boolean{
 const[A,B,C,D]=[a,b,c,d].map(i=>ps[i]),scale=Math.max(...[A,B,C,D].flatMap(p=>[A,B,C,D].map(q=>(p[0]-q[0])**2+(p[1]-q[1])**2))),epsilon=scale*1e-12,near=Math.sqrt(scale)*1e-10,values=[signedArea(A,B,C),signedArea(A,B,D),signedArea(C,D,A),signedArea(C,D,B)],on=(p:Vec,x:Vec,y:Vec)=>p.every((v,i)=>v>=Math.min(x[i],y[i])-near&&v<=Math.max(x[i],y[i])+near);
 return values[0]*values[1]<0&&values[2]*values[3]<0||Math.abs(values[0])<=epsilon&&on(C,A,B)||Math.abs(values[1])<=epsilon&&on(D,A,B)||Math.abs(values[2])<=epsilon&&on(A,C,D)||Math.abs(values[3])<=epsilon&&on(B,C,D);
}
function simplePolygon(ps:Vec[],polygon:number[]):boolean{for(let i=0;i<polygon.length;i++)for(let j=i+1;j<polygon.length;j++){const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[j],d=polygon[(j+1)%polygon.length];if(a!==c&&a!==d&&b!==c&&b!==d&&segmentsMeet(ps,a,b,c,d))return false;}return true;}
function visibleDiagonal(ps:Vec[],polygon:number[],a:number,b:number):boolean{
 for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length];if(c===a&&d===b||c===b&&d===a)return true;if(c!==a&&c!==b&&d!==a&&d!==b&&segmentsMeet(ps,a,b,c,d))return false;}
 const x=(ps[a][0]+ps[b][0])/2,y=(ps[a][1]+ps[b][1])/2;let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const A=ps[polygon[i]],B=ps[polygon[j]];if((A[1]>y)!==(B[1]>y)&&x<(B[0]-A[0])*(y-A[1])/(B[1]-A[1])+A[0])inside=!inside;}return inside;
}

export function avoidFoldedTriangles(vertices:Vec[],uvs:Vec[][],input:ArrayLike<number>,controlCount=vertices.length,repairCavities=true):Uint32Array{

 const triangles=Uint32Array.from(input),folds=(ids:number[])=>uvs.reduce((sum,uv)=>sum+(signedArea(vertices[ids[0]],vertices[ids[1]],vertices[ids[2]])*signedArea(uv[ids[0]],uv[ids[1]],uv[ids[2]])< -1e-13?1:0),0);

 for(let iteration=0;iteration<64;iteration++){

  const edges=new Map<string,{t:number;a:number;b:number;c:number}[]>();for(let t=0;t<triangles.length;t+=3)for(let i=0;i<3;i++){const a=triangles[t+i],b=triangles[t+(i+1)%3],c=triangles[t+(i+2)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');const list=edges.get(key)??[];list.push({t,a,b,c});edges.set(key,list);}

  let changed=false;for(const pair of edges.values()){

   if(pair.length!==2)continue;const [u,v]=pair,{a,b,c}=u,d=v.c;

   if(signedArea(vertices[c],vertices[d],vertices[a])*signedArea(vertices[c],vertices[d],vertices[b])>= -1e-15)continue;

   const oldA=Array.from(triangles.slice(u.t,u.t+3)),oldB=Array.from(triangles.slice(v.t,v.t+3)),before=folds(oldA)+folds(oldB);if(!before)continue;

   const nextA=[c,d,a],nextB=[d,c,b];if(repairCavities&&[nextA,nextB].some(ids=>!triangleHasArea(vertices,ids)||uvs.some(uv=>!triangleHasArea(uv,ids)))||folds(nextA)+folds(nextB)>=before)continue;

   const sign=signedArea(vertices[oldA[0]],vertices[oldA[1]],vertices[oldA[2]]);for(const ids of [nextA,nextB])if(signedArea(vertices[ids[0]],vertices[ids[1]],vertices[ids[2]])*sign<0)[ids[1],ids[2]]=[ids[2],ids[1]];

   triangles.set(nextA,u.t);triangles.set(nextB,v.t);changed=true;break;

  }if(!changed)break;

 }
 // Greedy flips can stop at a local minimum. Retriangulate a small simple
 // polygon around an unresolved cell using only compatible existing vertices.
 // This changes connectivity, never authored vertices or source coordinates.
 if(repairCavities)for(let round=0;round<8;round++){const improved=searchCompatibleCavity(vertices,uvs,triangles,controlCount);if(!improved)break;triangles.set(improved);}
 return triangles;

}

function searchCompatibleCavity(vertices:Vec[],uvs:Vec[][],input:Uint32Array,controlCount:number):Uint32Array|undefined{
 const faces=Array.from({length:input.length/3},(_,i)=>Array.from(input.slice(i*3,i*3+3))),bad=faces.map((ids,i)=>ids.every(id=>id<controlCount)&&uvs.some(uv=>signedArea(vertices[ids[0]],vertices[ids[1]],vertices[ids[2]])*signedArea(uv[ids[0]],uv[ids[1]],uv[ids[2]])< -1e-13)?i:-1).filter(i=>i>=0);if(!bad.length)return;
 const edges=new Map<string,number[]>(),neighbors=faces.map(()=>new Set<number>()),edgeKey=(a:number,b:number)=>[Math.min(a,b),Math.max(a,b)].join(',');
 faces.forEach((ids,t)=>{for(let i=0;i<3;i++){const key=edgeKey(ids[i],ids[(i+1)%3]),list=edges.get(key)??[];list.push(t);edges.set(key,list);}});for(const pair of edges.values())if(pair.length===2){neighbors[pair[0]].add(pair[1]);neighbors[pair[1]].add(pair[0]);}
 const queue=bad.map(i=>[i]),seen=new Set(queue.map(ids=>ids.join(','))),compatible=new Map<string,boolean>();let examined=0;
 for(let head=0;head<queue.length&&examined<512;head++,examined++){
  const cavity=queue[head],inside=new Set(cavity),boundary=new Map<number,number>(),used=new Set<number>();let simple=true;
  for(const t of cavity)for(let i=0;i<3;i++){const a=faces[t][i],b=faces[t][(i+1)%3];used.add(a);if(edges.get(edgeKey(a,b))!.filter(t=>inside.has(t)).length!==1)continue;if(boundary.has(a))simple=false;boundary.set(a,b);}
  if(simple&&boundary.size===cavity.length+2&&used.size===boundary.size){
   const start=Math.min(...boundary.keys()),polygon=[start];let next=boundary.get(start)!;while(next!==start&&polygon.length<=boundary.size){polygon.push(next);next=boundary.get(next)!;}simple=next===start&&polygon.length===boundary.size;
   if(simple&&[vertices,...uvs].every(ps=>simplePolygon(ps,polygon))){
    const first=faces[cavity[0]],sign=Math.sign(signedArea(vertices[first[0]],vertices[first[1]],vertices[first[2]])),old=new Set(cavity.map(t=>faces[t].slice().sort((a,b)=>a-b).join(','))),count=polygon.length;
    const diagonals=new Map<string,boolean>(),visible=(a:number,b:number)=>{const key=edgeKey(a,b);if(!diagonals.has(key))diagonals.set(key,[vertices,...uvs].every(ps=>visibleDiagonal(ps,polygon,a,b)));return diagonals.get(key)!;};
    type Cell={cost:number;triangles:number[][]};const dp:(Cell|undefined)[][]=Array.from({length:count},()=>Array(count));for(let i=0;i<count-1;i++)dp[i][i+1]={cost:0,triangles:[]};
    for(let span=2;span<count;span++)for(let i=0;i+span<count;i++){const j=i+span;for(let k=i+1;k<j;k++){
     const left=dp[i][k],right=dp[k][j];if(!left||!right)continue;const ids=[polygon[i],polygon[k],polygon[j]],key=ids.join(',');let valid=compatible.get(key);if(valid===undefined){valid=[vertices,...uvs].every(ps=>triangleHasArea(ps,ids)&&signedArea(ps[ids[0]],ps[ids[1]],ps[ids[2]])*sign>0);compatible.set(key,valid);}if(!valid||!visible(ids[0],ids[1])||!visible(ids[1],ids[2])||!visible(ids[2],ids[0]))continue;
     const cost=left.cost+right.cost+(old.has(ids.slice().sort((a,b)=>a-b).join(','))?0:1);if(!dp[i][j]||cost<dp[i][j]!.cost)dp[i][j]={cost,triangles:[...left.triangles,...right.triangles,ids]};
    }}
    const result=dp[0][count-1];if(result){const triangles=input.slice();cavity.forEach((t,i)=>triangles.set(result.triangles[i],t*3));return triangles;}
   }
  }
  if(cavity.length>=8)continue;const adjacent=new Set(cavity.flatMap(t=>[...neighbors[t]]));for(const t of [...adjacent].sort((a,b)=>a-b))if(!inside.has(t)){const expanded=[...cavity,t].sort((a,b)=>a-b),key=expanded.join(',');if(!seen.has(key)){seen.add(key);queue.push(expanded);}}
 }
}

export async function buildMesh(spec:RenderSpec,cancelled:()=>boolean):Promise<WarpMesh>{

  const controls=buildControls(spec);const {q,uv}=controls;const aspect=spec.recipe.aspect;

  if(cancelled())throw new Error('cancelled');

  // An unfinished manual outline has no 2D warp yet. Keep a fitted image and
  // registered masks instead of extrapolating a singular/near-flat triangle.
  if(![q,...uv].every(spansPlane)){const vertices:Vec[]=[[0,0],[aspect,0],[aspect,1],[0,1]],uvs=controls.sources.map(s=>{const a=sourceAlignment(s,aspect,spec.recipe.frameScale,spec.recipe.frameOffsetY);return vertices.map(a.inverse);});return {vertices,triangles:new Uint32Array([0,1,2,0,2,3]),uvs,controls,maxError:0};}

  if(spec.recipe.warp==='triangles'){

   // Rasterize the actual control triangulation. Retriangulating a sampled grid

   // can cross its edges and introduce an entirely different interpolation.

   const minX=Math.min(0,...q.map(p=>p[0])),maxX=Math.max(aspect,...q.map(p=>p[0])),minY=Math.min(0,...q.map(p=>p[1])),maxY=Math.max(1,...q.map(p=>p[1])),pad=Math.max(maxX-minX,maxY-minY)*2;

   const currentLayout=spec.template.id==='face-controls'||controls.sources.some(s=>(s.fitVersion??0)>=3);
   const outer:Vec[]=[[minX-pad,minY-pad],[maxX+pad,minY-pad],[maxX+pad,maxY+pad],[minX-pad,maxY+pad]],vertices=[...q,...outer],uvs=uv.map(ps=>[...ps,...outer.map(v=>applyBasis(mlsBasis(q,v),ps))]),triangles=avoidFoldedTriangles(vertices,uvs,Delaunator.from(vertices).triangles,q.length,currentLayout);

   diagnoseFolds(controls,vertices,uvs,triangles,aspect,currentLayout?q.length:0);return {vertices,triangles,uvs,controls,maxError:0};

  }

  let vertices:Vec[]=q.slice();const draft=spec.quality==='preview'&&spec.size<=512,grid=spec.quality==='final'?20:draft?6:12;

  for(let y=0;y<=grid;y++)for(let x=0;x<=grid;x++){const p:Vec=[x/grid*aspect,y/grid];if(!vertices.some(v=>Math.hypot(p[0]-v[0],p[1]-v[1])<1e-7))vertices.push(p);}

  const mappers:((v:Vec)=>Vec)[]=[];

  const evalAll=(p:Vec)=>{if(spec.recipe.frameAnchors&&p[0]>=0&&p[0]<=aspect&&p[1]>=0&&p[1]<=1&&Math.min(p[0],aspect-p[0],p[1],1-p[1])<1e-10)return controls.sources.map(s=>sourceAlignment(s,aspect,spec.recipe.frameScale,spec.recipe.frameOffsetY).inverse(p));if(mappers.length)return mappers.map(f=>f(p));const b=mlsBasis(q,p);return uv.map(u=>applyBasis(b,u));};

  let uvs:Vec[][]=controls.sources.map(()=>[]);for(let i=0;i<vertices.length;i++){const mapped=evalAll(vertices[i]);mapped.forEach((v,s)=>uvs[s].push(v));}

  const tolerance=spec.quality==='final'?.22:draft?3:1.25,maxVertices=spec.quality==='final'?32000:draft?1200:5500;

  let triangles=Delaunator.from(vertices).triangles,maxError=0;

  const vertexKeys=new Set(vertices.map(p=>p.map(v=>v.toFixed(8)).join(',')));

  for(let round=0;round<(draft?1:spec.quality==='final'?13:6);round++){

    if(cancelled())throw new Error('cancelled');

    const additions:Vec[]=[];const seen=new Set<string>();maxError=0;

    for(let t=0;t<triangles.length;t+=3){

      const ia=triangles[t],ib=triangles[t+1],ic=triangles[t+2];

      const mid:Vec=[(vertices[ia][0]+vertices[ib][0]+vertices[ic][0])/3,(vertices[ia][1]+vertices[ib][1]+vertices[ic][1])/3];

      const truth=evalAll(mid);let err=0;

      for(let s=0;s<uvs.length;s++){

        const scale=Math.min(1,spec.quality==='final'?1:1024/Math.max(controls.sources[s].width,controls.sources[s].height));

        err=Math.max(err,Math.hypot((truth[s][0]-(uvs[s][ia][0]+uvs[s][ib][0]+uvs[s][ic][0])/3)*controls.sources[s].width*scale,(truth[s][1]-(uvs[s][ia][1]+uvs[s][ib][1]+uvs[s][ic][1])/3)*controls.sources[s].height*scale));

      }

      maxError=Math.max(maxError,err);

      if(err>tolerance&&vertices.length+additions.length<maxVertices){

        for(const [a,b] of [[ia,ib],[ib,ic],[ic,ia]]){const m:Vec=[(vertices[a][0]+vertices[b][0])/2,(vertices[a][1]+vertices[b][1])/2],key=m.map(v=>v.toFixed(8)).join(',');if(!seen.has(key)&&!vertexKeys.has(key)){seen.add(key);additions.push(m);}}

      }

      if(t%600===0){await new Promise(r=>setTimeout(r,0));if(cancelled())throw new Error('cancelled');}

    }

    if(!additions.length||vertices.length>=maxVertices)break;

    for(const v of additions.slice(0,maxVertices-vertices.length)){vertices.push(v);vertexKeys.add(v.map(n=>n.toFixed(8)).join(','));evalAll(v).forEach((p,s)=>uvs[s].push(p));}

    triangles=Delaunator.from(vertices).triangles;

  }

  diagnoseFolds(controls,vertices,uvs,triangles,aspect);

  if(spec.quality==='final'&&maxError>.25)controls.diagnostics.push({kind:'warning',message:`Adaptive sampling reached its refinement limit (estimated maximum ${maxError.toFixed(2)} source pixels).`});

  return {vertices,triangles:new Uint32Array(triangles),uvs,controls,maxError};

}

function diagnoseFolds(controls:Controls,vertices:Vec[],uvs:Vec[][],triangles:ArrayLike<number>,aspect:number,controlCount=0){

  for(let s=0;s<uvs.length;s++){

    let folds=0,degenerate=0;let location:Vec|undefined;const foldedIds=new Set<string>(),flatIds=new Set<string>();

    for(let i=0;i<triangles.length;i+=3){const a=triangles[i],b=triangles[i+1],c=triangles[i+2];const area=signedArea(vertices[a],vertices[b],vertices[c]);const input=signedArea(uvs[s][a],uvs[s][b],uvs[s][c]);const center:Vec=[(vertices[a][0]+vertices[b][0]+vertices[c][0])/3,(vertices[a][1]+vertices[b][1]+vertices[c][1])/3];

      const real=a<controlCount&&b<controlCount&&c<controlCount,visible=real||center[0]>.22*aspect&&center[0]<.78*aspect&&center[1]>.28&&center[1]<.72;
      if(visible&&(real?area*input<0:area*input< -1e-13)){folds++;location=[center[0]/aspect,center[1]];[a,b,c].forEach(i=>{if(controls.ids[i])foldedIds.add(controls.ids[i]);});}if(real&&(!triangleHasArea(vertices,[a,b,c])||!triangleHasArea(uvs[s],[a,b,c]))){degenerate++;location=[center[0]/aspect,center[1]];[a,b,c].forEach(i=>flatIds.add(controls.ids[i]));}}

    if(folds)controls.diagnostics.push({kind:'warning',code:'folded-cells',pointIds:[...foldedIds].sort(),sourceId:controls.sources[s].id,message:`${controls.sources[s].name}: ${folds} locally folded mesh cells; inspect and adjust the highlighted controls.`,position:location});
    if(degenerate)controls.diagnostics.push({kind:'warning',code:'flat-cells',pointIds:[...flatIds].sort(),sourceId:controls.sources[s].id,message:`${controls.sources[s].name}: ${degenerate} nearly flat control cells; inspect and adjust the highlighted controls.`,position:location});

  }

}

export function targetLandmarks(project:Project):Landmark[]{const c=buildControls({revision:project.revision,sources:project.sources,template:project.template,recipe:project.recipe,size:512,quality:'preview'});return c.ids.filter(id=>!id.startsWith('frame')).map((id,i)=>({id,x:project.recipe.flipOutput?1-c.q[i][0]/project.recipe.aspect:c.q[i][0]/project.recipe.aspect,y:c.q[i][1],enabled:true,locked:false,authored:!!project.recipe.pins[id],confidence:1}));}

export function regionsGeometry(template:Template,controls:Controls,aspect:number):{centers:Vec[];radii:Vec[]}{

 const fallback:Record<Region,[number,number,number,number]>={eyes:[.5,.4,.19,.055],brows:[.5,.35,.2,.055],nose:[.5,.49,.09,.11],mouth:[.5,.6,.13,.065],outline:[.5,.5,.3,.28],hair:[.5,.18,.42,.24],ears:[.5,.48,.48,.1],neck:[.5,.77,.22,.14],clothing:[.5,.99,.6,.24]};

 const centers:Vec[]=[],radii:Vec[]=[];

 for(const r of ['eyes','brows','nose','mouth','outline','hair','ears','neck','clothing'] as Region[]){const positions=template.points.filter(d=>d.region===r).map(d=>controls.q[controls.ids.indexOf(d.id)]).filter(Boolean);const f=fallback[r];let cx=f[0]*aspect,cy=f[1];if(positions.length){cx=positions.reduce((s,p)=>s+p[0],0)/positions.length;cy=positions.reduce((s,p)=>s+p[1],0)/positions.length;}

 centers.push([cx/aspect,cy]);radii.push([f[2],f[3]]);}

 return {centers,radii};

}

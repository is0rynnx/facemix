import {REGIONS,type RenderSpec,type Vec} from '../types';

import {normalize,regionalInfluence,type Controls} from './math';
import {BoundedCache} from './cache';
import {sampleMask} from './contour-evidence';
import {regionEvidence,regionEvidenceKey} from './region-evidence';
import {featherFeatureMask} from './mask-feather';
const fields=new BoundedCache<Float64Array>(2,192*240*9*2);

export interface WeightMap {width:number;height:number;data:Float32Array;}

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

function distance(p:Vec,polygon:Vec[]){let inside=false,min=Infinity;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){

 const a=polygon[j],b=polygon[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/Math.max(1e-12,dx*dx+dy*dy)));

 min=Math.min(min,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;

 }return inside?min:-min;}

/** A partition of unity with a protected face opening. Hair has zero support inside it. */

export function regionPartition(spec:RenderSpec,controls:Controls):(p:Vec)=>number[]{

 const points=new Map(controls.ids.map((id,i)=>[id,[controls.q[i][0]/spec.recipe.aspect,controls.q[i][1]] as Vec]));

 const get=(id:string,f:Vec):Vec=>points.get(id)??f,feather=Math.max(.000001,spec.recipe.regionFeather??.012);

 const face=['p41','p27','p19','p29','p20','p23','p25','p15','p24','p22','p21','p28','p18','p26'].map(id=>points.get(id)).filter(Boolean) as Vec[];

 const chin=get('p15',[.5,.68]),left=get('p04',[.38,.4]),li=get('p01',[.46,.4]),right=get('p03',[.62,.4]),ri=get('p02',[.54,.4]);

 const ellipse=(p:Vec,c:Vec,rx:number,ry:number)=>1-smooth(1,1+feather/Math.max(.008,ry),Math.hypot((p[0]-c[0])/Math.max(.008,rx),(p[1]-c[1])/Math.max(.008,ry)));

 const center=(a:Vec,b:Vec):Vec=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

 const mouthA=get('p16',[.43,.59]),mouthB=get('p17',[.57,.59]),mouthBottom=get('p40',[.5,.62]),mouthCenter=center(mouthA,mouthB),noseTop=get('p12',[.5,.42]),noseBottom=get('p11',[.5,.54]),noseCenter=center(noseTop,noseBottom);
 const lb=center(get('p08',[.34,.35]),get('p07',[.46,.35])),rb=center(get('p06',[.66,.35]),get('p05',[.54,.35]));

 const evidence=regionEvidence(spec,controls),eyeCenter=center(center(left,li),center(right,ri)),aspect=spec.recipe.aspect,faceHeight=Math.max(.1,Math.hypot((chin[0]-eyeCenter[0])*aspect,chin[1]-eyeCenter[1])),down:Vec=[(chin[0]-eyeCenter[0])*aspect/faceHeight,(chin[1]-eyeCenter[1])/faceHeight];
 const paintedMasks=REGIONS.map(r=>{const mask=spec.recipe.regionMasks?.[r];return mask?featherFeatureMask(mask,spec.recipe.regionFeather??.012):undefined;});

 return p=>{

  const f=face.length>3?smooth(-feather,feather,distance(p,face)):ellipse(p,[.5,.49],.25,.25);

  const le=ellipse(p,center(left,li),Math.abs(li[0]-left[0])*.62,.016+Math.abs(li[1]-left[1])*.45),re=ellipse(p,center(right,ri),Math.abs(right[0]-ri[0])*.62,.016+Math.abs(right[1]-ri[1])*.45);

  const eyes=Math.max(le,re)*f;

  const brows=Math.max(ellipse(p,lb,.07,.013),ellipse(p,rb,.07,.013))*f*(1-eyes);

  const mouth=ellipse(p,[mouthCenter[0],(mouthCenter[1]+mouthBottom[1])/2],Math.abs(mouthB[0]-mouthA[0])*.62,Math.max(.02,Math.abs(mouthBottom[1]-mouthCenter[1])+.008))*f*(1-eyes)*(1-brows);

  const nose=ellipse(p,noseCenter,Math.max(.027,Math.abs(get('p13',[.55,.53])[0]-get('p14',[.45,.53])[0])*.65),Math.abs(noseBottom[1]-noseTop[1])*.55)*f*(1-eyes)*(1-brows)*(1-mouth);

  const skin=Math.max(0,f-eyes-brows-mouth-nose),below=smooth(chin[1]+.02,chin[1]+.09,p[1]),garment=smooth(chin[1]+.12,chin[1]+.22,p[1]);

  const sideA=get('p28',get('p18',[.25,.48])),sideB=get('p29',get('p19',[.75,.48])),faceWidth=Math.max(.15,Math.abs(sideB[0]-sideA[0]));
  const ears=(1-f)*(1-below)*Math.max(ellipse(p,get('p45',[sideA[0]-faceWidth*.06,sideA[1]]),faceWidth*.12,faceHeight*.38),ellipse(p,get('p42',[sideB[0]+faceWidth*.06,sideB[1]]),faceWidth*.12,faceHeight*.38));

  const outside=Math.max(0,1-f-ears),hair=outside*(1-below),neck=outside*below*(1-garment),clothing=outside*below*garment;

  let outer=[hair,ears,neck,clothing];
  if(evidence){
   const [faceSkin,hairClass,body,cloth,accessory]=evidence.map(mask=>sampleMask(mask,...p)),along=(p[0]-chin[0])*aspect*down[0]+(p[1]-chin[1])*down[1],across=Math.abs((p[0]-chin[0])*aspect*down[1]-(p[1]-chin[1])*down[0]);
   const neckGate=smooth(-feather,feather,along)*(1-smooth(faceHeight*.45,faceHeight*.9,along))*(1-smooth(faceHeight*.4,faceHeight*.85,across));
   const skinEar=ears*faceSkin,skinNeck=body*neckGate;
   const classes=normalize([hairClass+accessory*(1-below),skinEar,skinNeck,cloth+body*(1-neckGate)+accessory*below]);
   if(classes.some(Boolean))outer=classes.map(v=>v*(1-f));
  }
  const raw=normalize([eyes,brows,nose,mouth,skin,...outer]),painted=paintedMasks.map(mask=>mask?sampleWeight(mask,p[0],p[1])/255:undefined);

  const total=painted.reduce<number>((sum,v)=>sum+(v??0),0),available=raw.reduce((sum,v,i)=>sum+(painted[i]===undefined?v:0),0);

  return normalize(raw.map((v,i)=>painted[i]??(available>0?v/available*Math.max(0,1-total):0)));

 };

}

export function regionalWeightMaps(spec:RenderSpec,controls:Controls):WeightMap[]{

 const weights=REGIONS.map(r=>regionalInfluence(controls.sources,r,'appearance',spec.recipe));

 const regional=Object.keys(spec.recipe.regionSources??{}).length>0||controls.sources.some(s=>REGIONS.some(r=>s.regionWeights[r]?.appearance!==1));

 if(!regional||spec.inspectSourceId)return controls.sources.map((s,i)=>({width:1,height:1,data:new Float32Array([spec.inspectSourceId?(s.id===spec.inspectSourceId?1:0):weights[0][i]])}));

 const width=192,height=240,maps=controls.sources.map(()=>({width,height,data:new Float32Array(width*height)}));
 const key=JSON.stringify([regionEvidenceKey(spec,controls),spec.recipe.regionFeather,spec.recipe.regionMasks]);
 let field=fields.get(key);
 if(!field){const partition=regionPartition(spec,controls);field=new Float64Array(width*height*REGIONS.length);for(let i=0;i<width*height;i++)field.set(partition([(i%width+.5)/width,(Math.floor(i/width)+.5)/height]),i*REGIONS.length);fields.set(key,field,field.length);}
 for(let s=0;s<maps.length;s++){const ws=weights.map(row=>row[s]),out=maps[s].data;for(let i=0;i<out.length;i++){let sum=0;for(let r=0;r<REGIONS.length;r++)sum+=field[i*REGIONS.length+r]*ws[r];out[i]=sum;}}

 return maps;

}

export function sampleWeight(map:{width:number;height:number;data:ArrayLike<number>},x:number,y:number){const u=x*map.width-.5,v=y*map.height-.5,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;let n=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)n+=map.data[Math.min(map.height-1,Math.max(0,iy+j))*map.width+Math.min(map.width-1,Math.max(0,ix+i))]*(i?fx:1-fx)*(j?fy:1-fy);return n;}

export function cropCoverage(u:number,v:number,width:number,height:number,feather:number){if(u<0||v<0||u>1||v>1)return 0;if(feather<=0)return 1;return smooth(0,feather,Math.min(u*width,(1-u)*width,v*height,(1-v)*height)/Math.max(width,height));}

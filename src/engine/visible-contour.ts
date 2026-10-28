import type {AnalysisMasks,Landmark,Vec} from '../types';
import type {DetectedPoint} from './fitting';
import {sampleMask,upperFaceControls,farSideContour} from './contour-evidence';
import {quadraticMinima} from './quadratic-minima';

const chain=[127,234,93,132,58,172,136,150,149,176,148,152,377,400,378,379,365,397,288,361,323,454,356];
const controls:Record<string,number[]>={p18:[127],p28:[234],p21:[132],p61:[58],p22:[172],p24:[150,149],p15:[152],p25:[379,378],p23:[397],p20:[361],p29:[454],p19:[356]};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const mix=(a:Vec,b:Vec,t:number):Vec=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];

/** Refine existing contour IDs together. Upper-face searches follow the eye
 * frame: a projected far-side mesh tangent can point into the face under yaw.
 * Unsupported samples never establish an observed boundary. No model runs here. */
export function reviewVisibleContour(landmarks:Landmark[],current:DetectedPoint[],width:number,height:number,masks?:AnalysisMasks):Landmark[]{
 const face=masks?.face;
 if(!face||face.width<16||face.height<16||width<=0||height<=0||[...chain,1,33,263].some(i=>!current[i]||!Number.isFinite(current[i].x)||!Number.isFinite(current[i].y)))return landmarks;
 const px=(i:number):Vec=>[current[i].x*width,current[i].y*height],left=px(33),right=px(263),span=Math.hypot(right[0]-left[0],right[1]-left[1]);
 if(span<2)return landmarks;
 const eye:Vec=[(right[0]-left[0])/span,(right[1]-left[1])/span],down:Vec=[-eye[1],eye[0]],center=mix(left,right,.5),nose=px(1),chin=px(152),chinLevel=(chin[0]-center[0])*down[0]+(chin[1]-center[1])*down[1];
 if(chinLevel<span*.1)return landmarks;
 const seed=chain.map(px),lengths=[0];
 for(let i=1;i<seed.length;i++)lengths.push(lengths[i-1]+Math.hypot(seed[i][0]-seed[i-1][0],seed[i][1]-seed[i-1][1]));
 const total=lengths.at(-1)!;if(total<span*.2)return landmarks;
 const rows=129,columns=97,radius=span*.24,at=(i:number)=>i*total/(rows-1),sample=(p:Vec)=>sampleMask(face,p[0]/width,p[1]/height);
 const base:Vec[]=Array.from({length:rows},(_,i)=>{const t=at(i);let j=1;while(j<lengths.length-1&&lengths[j]<t)j++;return mix(seed[j-1],seed[j],(t-lengths[j-1])/Math.max(1e-9,lengths[j]-lengths[j-1]));});
 const covered=(p:Vec)=>sample(p)<.3&&Math.max(...(['hair','body','clothing','accessories'] as const).map(k=>sampleMask(masks?.[k],p[0]/width,p[1]/height)))>.5;
 const normals:Vec[]=[],support:Float64Array[]=[],usable:boolean[]=[],unary:Float64Array[]=[];
 const offsets=Float64Array.from({length:columns},(_,j)=>-radius+j*2*radius/(columns-1));
 for(let i=0;i<rows;i++){
  const a=base[Math.max(0,i-1)],b=base[Math.min(rows-1,i+1)],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(length<1e-9)return landmarks;
  let normal:Vec=[-(b[1]-a[1])/length,(b[0]-a[0])/length];if(normal[0]*(base[i][0]-nose[0])+normal[1]*(base[i][1]-nose[1])<0)normal=[-normal[0],-normal[1]];
  const level=((base[i][0]-center[0])*down[0]+(base[i][1]-center[1])*down[1])/chinLevel,t=clamp((level-.5)/.45,0,1),blend=t*t*(3-2*t),side=at(i)<=lengths[chain.indexOf(152)]?-1:1;
  normal=[normal[0]*blend+side*eye[0]*(1-blend),normal[1]*blend+side*eye[1]*(1-blend)];const n=Math.hypot(...normal);if(n<1e-6)return landmarks;normal=[normal[0]/n,normal[1]/n];normals.push(normal);
  const probe=Math.max(width/face.width,height/face.height,span*.012)*1.5,row=new Float64Array(columns),strengths=new Float64Array(columns);
  for(let j=0;j<columns;j++){
   const d=offsets[j],point:Vec=[base[i][0]+normal[0]*d,base[i][1]+normal[1]*d],inside=sample([point[0]-normal[0]*probe,point[1]-normal[1]*probe]),outside=sample([point[0]+normal[0]*probe,point[1]+normal[1]*probe]);
   strengths[j]=Math.max(0,inside-outside);row[j]=.6*Math.abs(sample(point)-.5)-.8*strengths[j]+.12*(d/radius)**2;
  }
  const bodyCovered=sample(base[i])<.3&&sampleMask(masks?.body,base[i][0]/width,base[i][1]/height)>.5;
  const valid=Math.max(...strengths)>.22&&!bodyCovered;usable.push(valid);if(!valid)for(let j=0;j<columns;j++)row[j]=.5*(offsets[j]/radius)**2;
  support.push(strengths);unary.push(row);
 }
 // A smooth displacement field favors coherent changes along one ordered curve.
 const transitionScale=.8*(2*radius/(columns-1)/Math.max(span*.025,1))**2;
 let cost=unary[0];const back:Uint8Array[]=[];
 for(let i=1;i<rows;i++){
  const indices=quadraticMinima(cost,transitionScale),next=Float64Array.from(indices,(k,j)=>cost[k]+transitionScale*(j-k)**2+unary[i][j]);
  back.push(indices);cost=next;
 }
 let index=0;for(let j=1;j<columns;j++)if(cost[j]<cost[index])index=j;
 const path=new Uint8Array(rows);path[rows-1]=index;for(let i=rows-2;i>=0;i--)path[i]=back[i][path[i+1]];
 const supported=base.map((_,i)=>usable[i]&&support[i][path[i]]>.18),chosen:Vec[]=base.map((p,i)=>supported[i]?[p[0]+normals[i][0]*offsets[path[i]],p[1]+normals[i][1]*offsets[path[i]]]:p);
 return landmarks.map(p=>{
  const vertices=controls[p.id];if(!vertices||p.authored||p.locked||!p.enabled)return p;
  const parameter=vertices.reduce((sum,v)=>sum+lengths[chain.indexOf(v)],0)/vertices.length/total*(rows-1),nearest=Math.round(parameter),a=Math.min(rows-2,Math.floor(parameter)),t=parameter-a;
  if(!supported[nearest])return covered([p.x*width,p.y*height])?{...p,enabled:false,autoDisabled:true,confidence:.2,review:'Face boundary is covered. Place this control manually to use it.'}:{...p,confidence:Math.min(p.confidence,.55),review:'Face boundary has weak image support. Check this control.'};
  const point=mix(chosen[a],chosen[a+1],t),x=point[0]/width,y=point[1]/height;
  if(x<0||y<0||x>1||y>1)return p;
  if(upperFaceControls.has(p.id)&&!farSideContour(p.id,current,width,height)){
   const seed=mix(base[a],base[a+1],t),side=p.id==='p18'||p.id==='p28'?-1:1,outward=side*((point[0]-seed[0])*eye[0]+(point[1]-seed[1])*eye[1]),texel=1/Math.hypot(eye[0]*face.width/width,eye[1]*face.height/height);
   if(outward>Math.max(span*.012,texel*.75))return {...p,confidence:Math.min(p.confidence,.55),review:'Skin selection extends beyond the face contour. Detector position kept; check this control.'};
  }
  return {...p,x,y,confidence:Math.min(.9,.7+support[nearest][path[nearest]]*.2),review:undefined};
 });
}

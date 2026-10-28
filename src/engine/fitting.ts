/* Initialization only. Rendering uses the visible, editable correspondence set. */
import type {AnalysisMasks,Landmark,Mask,PointDefinition,Source,Template,Vec} from '../types';
import {reviewFaceContour,reviewFeatureEvidence,reviewContourShape,sampleMask} from './contour-evidence';
import {headMaskFromAnalysis,reviewFrontOpening} from './head-evidence';
import {reviewVisibleContour} from './visible-contour';
export interface DetectedPoint {x:number;y:number;}
export const FIT_VERSION=11;
export const CALIBRATION_VERSION='reference-478-v1';
const finite=(p:DetectedPoint|undefined):p is DetectedPoint=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
// Recipes are fixed correspondences, in image-side convention. Unsupported
// ears, neck and hair retain an explicitly estimated reference transfer.
export const semanticVertices:Record<string,number>={p01:133,p02:362,p03:263,p04:33,p11:2,p12:6,p13:327,p14:98,p15:152,p16:61,p17:291,p18:127,p19:356,p20:361,p21:132,p22:172,p23:397,p26:54,p27:284,p28:234,p29:454,p30:468,p31:473,p38:37,p39:267,p40:17,p46:200,p55:1,p61:58};
const browPairs:Record<string,[number,number]>={p05:[336,285],p06:[300,276],p07:[107,55],p08:[70,46],p09:[105,52],p10:[334,282]};
const contourPairs:Record<string,[number,number]>={p24:[150,149],p25:[379,378]};
// Unsupported outer controls use a fixed nearby face-oval segment as a local
// frame. Their original reference offsets remain estimates. Global MLS
// extrapolation can move an ear through the measured cheek on a turned face.
const estimateFrames:Record<string,[number,number]>={p42:[356,454],p43:[454,361],p44:[234,132],p45:[127,234],p58:[172,150],p59:[397,379]};
const irisGuides:Record<string,[number,number,number]>={p32:[473,-Math.SQRT1_2,Math.SQRT1_2],p33:[473,Math.SQRT1_2,Math.SQRT1_2],p34:[468,-Math.SQRT1_2,Math.SQRT1_2],p35:[468,Math.SQRT1_2,Math.SQRT1_2],p36:[468,0,-1],p37:[473,0,-1]};
export function semanticPoint(def:PointDefinition,current:DetectedPoint[],reference:DetectedPoint[],aspect=.8):Vec{
 const index=def.detectorIndex??semanticVertices[def.id];
 if(index!==undefined&&finite(current[index]))return [current[index].x,current[index].y];
 const pair=browPairs[def.id]??contourPairs[def.id];if(pair&&pair.every(i=>finite(current[i])))return [(current[pair[0]].x+current[pair[1]].x)/2,(current[pair[0]].y+current[pair[1]].y)/2];
 const frame=estimateFrames[def.id];if(frame&&frame.every(i=>finite(current[i])&&finite(reference[i]))){
  const [a,b]=frame.map(i=>reference[i]),[A,B]=frame.map(i=>current[i]),vx=(b.x-a.x)*.8,vy=b.y-a.y,dx=(def.reference[0]-a.x)*.8,dy=def.reference[1]-a.y,length=vx*vx+vy*vy;
  if(length>1e-12&&aspect>0){const t=(dx*vx+dy*vy)/length,u=(vx*dy-vy*dx)/length,x=(B.x-A.x)*aspect,y=B.y-A.y;return [A.x+(t*x-u*y)/aspect,A.y+t*y+u*x];}
 }
 const iris=irisGuides[def.id];if(iris&&[iris[0],iris[0]+1,iris[0]+2,iris[0]+3,iris[0]+4].every(i=>finite(current[i]))){
  const [i,u,v]=iris,c=current[i],a=current[i+1],b=current[i+3],top=current[i+2],bottom=current[i+4];
  return [c.x+u*(a.x-b.x)/2+v*(bottom.x-top.x)/2,c.y+u*(a.y-b.y)/2+v*(bottom.y-top.y)/2];
 }
 return transfer(reference,current,def.reference);
}

/** Measurements in a pixel-correct eye frame. Turn is a heuristic, not yaw. */
export function observe(current:DetectedPoint[],width:number,height:number):Source['observation']|undefined{
 if(![1,33,133,159,145,234,454,13,14,61,291,468,263].every(i=>finite(current[i]))||width<=0||height<=0)return;
 const px=(i:number):Vec=>[current[i].x*width,current[i].y*height],a=px(33),b=px(263),span=Math.hypot(b[0]-a[0],b[1]-a[1]);if(span<1e-6)return;
 const ex:Vec=[(b[0]-a[0])/span,(b[1]-a[1])/span],ey:Vec=[-ex[1],ex[0]],dot=(p:Vec,axis:Vec)=>p[0]*axis[0]+p[1]*axis[1],distance=(i:number,j:number)=>Math.hypot(...px(i).map((v,k)=>v-px(j)[k]) as Vec);
 const l=dot(px(234),ex),r=dot(px(454),ex),nose=dot(px(1),ex),iris=px(468),inner=px(133),upper=px(159),lower=px(145),eyeSpan=Math.max(1e-6,distance(33,133));
 return {turn:(2*nose-l-r)/Math.max(1e-6,r-l),mouthOpen:distance(13,14)/Math.max(1e-6,distance(61,291)),gaze:[dot([iris[0]-(a[0]+inner[0])/2,iris[1]-(a[1]+inner[1])/2],ex)/eyeSpan,dot([iris[0]-(upper[0]+lower[0])/2,iris[1]-(upper[1]+lower[1])/2],ey)/eyeSpan]};
}

/** First nearby supported head exit only. Never clamp an estimate to a crop. */
export function headBoundary(mask:Mask,center:Vec,p:Vec):{point:Vec;reason?:string}{
 const dx=p[0]-center[0],dy=p[1]-center[1],length=Math.hypot(dx*mask.width,dy*mask.height);if(length<2)return {point:p,reason:'Head boundary is weak'};
 const step=Math.min(.01,.5/length);let seen=false,previous=0,gaps=0;
 for(let t=.15;t<=1.75;t+=step){const x=center[0]+dx*t,y=center[1]+dy*t;if(x<=0||y<=0||x>=1||y>=1)return {point:p,reason:'Head boundary reaches the crop'};
  if(sampleMask(mask,x,y)>.5){seen=true;previous=t;gaps=0;}else if(seen&&(gaps+=step*length)>=1.5){if(previous<.3)return {point:p,reason:'Head boundary is weak'};const edge=previous+step/2;return {point:[center[0]+dx*edge,center[1]+dy*edge]};}
 }
 return {point:p,reason:'Head boundary is not clear'};
}
const headIds=['p50','p51','p48','p47','p54','p49','p53','p52'];
const headInnerEdges:Record<string,[string,string]>={p50:['p26','p18'],p51:['p26','p41'],p48:['p26','p41'],p47:['p26','p27'],p54:['p26','p27'],p49:['p41','p27'],p53:['p41','p27'],p52:['p27','p19']};
/** Review mask evidence at initialization. A face-skin exit may be an opening
 * inside the outer head boundary, so radial order alone is insufficient. Reject the
 * whole proposed head group rather than partially deforming an uncertain edge.
 * This never runs during rendering or against authored source coordinates. */
export function reviewHeadBoundaries(baseline:Landmark[],proposed:Landmark[],width:number,height:number):{landmarks:Landmark[];rejected:boolean}{
 const before=new Map(baseline.map(p=>[p.id,p])),after=new Map(proposed.map(p=>[p.id,p])),heads=new Set(headIds);
 const changed=headIds.some(id=>{const a=before.get(id),b=after.get(id);return a&&b&&(a.x!==b.x||a.y!==b.y);});if(!changed)return {landmarks:proposed,rejected:false};
 const px=(p:Landmark):Vec=>[p.x*width,p.y*height],area=(a:Landmark,b:Landmark,c:Landmark)=>{const A=px(a),B=px(b),C=px(c);return (B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);};
 const eyeA=before.get('p04'),eyeB=before.get('p03'),span=eyeA&&eyeB?Math.hypot((eyeA.x-eyeB.x)*width,(eyeA.y-eyeB.y)*height):Math.min(width,height)*.25,minArea=Math.max(.25,span*span*.0001),separation=Math.max(1,span*.02);
 let rejected=false;
 for(const id of headIds){const a=before.get(id),A=after.get(id);if(!a||!A)continue;
  for(const other of proposed){if(other.id===id)continue;const b=before.get(other.id);if(b&&Math.hypot((A.x-other.x)*width,(A.y-other.y)*height)<separation&&Math.hypot((a.x-b.x)*width,(a.y-b.y)*height)>=separation)rejected=true;}
  // Stay outside the corresponding face edge. Arbitrary triangles between
  // distant head and brow points can flip during a valid silhouette correction.
  const pair=headInnerEdges[id];if(pair.every(id=>before.has(id)&&after.has(id))){
   const oldArea=area(a,before.get(pair[0])!,before.get(pair[1])!),newArea=area(A,after.get(pair[0])!,after.get(pair[1])!);
   if(Math.abs(oldArea)>minArea&&(oldArea*newArea<=0||Math.abs(newArea)<Math.abs(oldArea)*.05))rejected=true;
  }
 }
 const edges=(ids:string[])=>ids.slice(1).map((id,i)=>[ids[i],id] as const),outer=edges(headIds.filter(id=>before.has(id)&&after.has(id))),inner=edges(['p18','p26','p41','p27','p19'].filter(id=>before.has(id)&&after.has(id)));
 const crosses=(map:Map<string,Landmark>,a:readonly[string,string],b:readonly[string,string])=>area(map.get(a[0])!,map.get(a[1])!,map.get(b[0])!)*area(map.get(a[0])!,map.get(a[1])!,map.get(b[1])!)<0&&area(map.get(b[0])!,map.get(b[1])!,map.get(a[0])!)*area(map.get(b[0])!,map.get(b[1])!,map.get(a[1])!)<0;
 for(let i=0;i<outer.length;i++)for(const edge of [...outer.slice(i+2),...inner])if(!outer[i].some(id=>edge.includes(id))&&crosses(after,outer[i],edge)&&!crosses(before,outer[i],edge))rejected=true;
 return {landmarks:rejected?proposed.map(p=>heads.has(p.id)?before.get(p.id)??p:p):proposed,rejected};
}
export function fitLandmarks(template:Template,current:DetectedPoint[],reference:DetectedPoint[],width:number,height:number,headMask?:Mask,analysisMasks?:AnalysisMasks):{landmarks:Landmark[];observation:Source['observation'];note?:string}{
 headMask=headMaskFromAnalysis(analysisMasks)??headMask;
 const observation=observe(current,width,height),reasons=new Set<string>(),unadjusted=new Map<string,Vec>();
 let landmarks=template.points.map(def=>{
  let xy=semanticPoint(def,current,reference,width/height),confidence=.85;
  if(!observation){confidence=.3;reasons.add('Face frame is incomplete or degenerate');}
  const required=def.detectorIndex??semanticVertices[def.id],pair=browPairs[def.id]??contourPairs[def.id];if((required!==undefined&&!finite(current[required]))||(pair&&!pair.every(i=>finite(current[i])))){confidence=.3;reasons.add('Incomplete face detection');}
  if(!xy.every(Number.isFinite)){xy=[...def.reference];confidence=.2;reasons.add('Incomplete face detection');}
  unadjusted.set(def.id,xy);
  if(['hair','ears','neck','clothing'].includes(def.region)||['p57','p58','p59'].includes(def.id)){confidence=.4;reasons.add('Hair, ears, forehead and neck need review');}
  if(/^p(47|48|49|50|51|52|53|54)$/.test(def.id)&&headMask&&finite(current[1])){const boundary=headBoundary(headMask,[current[1].x,current[1].y],xy);xy=boundary.point;if(boundary.reason)reasons.add(boundary.reason);else confidence=.6;}
  if(def.id==='p41'&&analysisMasks?.face){const opening=reviewFrontOpening(xy,current,width,height,analysisMasks);xy=opening.point;if(opening.supported)confidence=.75;else reasons.add('Front hair opening needs review');}
  if(def.region==='brows')confidence=.65;
  if(observation&&Math.abs(observation.turn)>.32&&['outline','eyes','brows'].includes(def.region)){confidence=Math.min(confidence,.6);reasons.add('Turned face: check the far eye and outline');}
  if(def.region==='eyes'){
   const i=def.id==='p31'||['p02','p03','p32','p33','p37'].includes(def.id)||(def.detectorIndex!==undefined&&def.detectorIndex>=362)?473:468,a=current[i+1],b=current[i+3],c=current[i+2],d=current[i+4];
   if(![a,b,c,d].every(finite)||Math.abs((a.x-b.x)*(c.y-d.y)-(a.y-b.y)*(c.x-d.x))<1e-10){confidence=.3;reasons.add('Iris geometry is weak');}
   const upper=current[i===468?159:386],lower=current[i===468?145:374];if(finite(upper)&&finite(lower)&&Math.hypot((upper.x-lower.x)*width,(upper.y-lower.y)*height)<Math.max(2,width*.002)){confidence=Math.min(confidence,.5);reasons.add('Small or closed eye: check eye controls');}
  }
  if(def.region==='mouth'&&observation&&observation.mouthOpen<.04){confidence=Math.min(confidence,.65);reasons.add('Closed mouth: check the lip seam');}
  const enabled=xy[0]>=0&&xy[0]<=1&&xy[1]>=0&&xy[1]<=1;if(!enabled){confidence=.15;reasons.add('Outside-photo controls are disabled in all-source correspondence');}
  const reviewed=reviewFaceContour({id:def.id,x:xy[0],y:xy[1],enabled,locked:false,authored:false,confidence},current,width,height,analysisMasks);
  if(reviewed.autoDisabled)reasons.add('Covered face-boundary controls are excluded until reviewed');
  return reviewFeatureEvidence(reviewed,def.region,analysisMasks);
 });
 const contourBaseline=landmarks.map(p=>{const xy=unadjusted.get(p.id)!;return {...p,x:xy[0],y:xy[1]};});landmarks=reviewContourShape(contourBaseline,landmarks,width,height);
 landmarks=reviewContourShape(contourBaseline,reviewVisibleContour(landmarks,current,width,height,analysisMasks),width,height);
 if(landmarks.some(p=>p.review?.includes('abrupt upper-cheek bend')))reasons.add('Ambiguous upper-cheek boundaries keep detector estimates for review');
 if(landmarks.some(p=>p.autoDisabled))reasons.add('Covered face-boundary controls are excluded until reviewed');
 if(headMask){const baseline=landmarks.map(p=>{const xy=unadjusted.get(p.id)!;return {...p,x:xy[0],y:xy[1],enabled:xy[0]>=0&&xy[0]<=1&&xy[1]>=0&&xy[1]<=1,confidence:headIds.includes(p.id)?.4:p.confidence};}),review=reviewHeadBoundaries(baseline,landmarks,width,height);landmarks=review.landmarks;if(review.rejected)reasons.add('Head boundary conflicts with face controls; estimated positions kept');}
 if(landmarks.some(p=>p.x<0||p.x>1||p.y<0||p.y>1))reasons.add('Outside-photo controls are disabled in all-source correspondence');
 return {landmarks,observation,note:reasons.size?[...reasons].join('. ')+'. Left and Right mean image side.':undefined};
}

 export const oval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
 const jaw=new Set(['p15','p20','p21','p22','p23','p24','p25','p61']);
 const left=new Set(['p30','p34','p35','p36']),right=new Set(['p31','p32','p33','p37']);
 export function point(def:PointDefinition,current:DetectedPoint[],reference:DetectedPoint[],template:Template,fallback:(p:Vec,current:DetectedPoint[])=>Vec):Vec{
  if(def.detectorIndex!==undefined&&current[def.detectorIndex])return [current[def.detectorIndex].x,current[def.detectorIndex].y];
  if(left.has(def.id)||right.has(def.id)){
   const isLeft=left.has(def.id),i=isLeft?468:473,center=template.points.find(p=>p.id===(isLeft?'p30':'p31'))?.reference??[reference[i].x,reference[i].y];
   const a=reference[i+1],b=reference[i+3],c=reference[i+2],d=reference[i+4],hx=(a.x-b.x)/2,hy=(a.y-b.y)/2,vx=(c.x-d.x)/2,vy=(c.y-d.y)/2,det=hx*vy-hy*vx;
   if(Math.abs(det)>1e-10){const dx=def.reference[0]-center[0],dy=def.reference[1]-center[1],u=(dx*vy-dy*vx)/det,v=(dy*hx-dx*hy)/det,A=current[i+1],B=current[i+3],C=current[i+2],D=current[i+4];return [current[i].x+u*(A.x-B.x)/2+v*(C.x-D.x)/2,current[i].y+u*(A.y-B.y)/2+v*(C.y-D.y)/2];}
  }
  if(def.id==='p56'){
   const A=template.points.find(p=>p.id==='p20'),B=template.points.find(p=>p.id==='p23');
   if(A&&B){const a=point(A,reference,reference,template,fallback),b=point(B,reference,reference,template,fallback),c:[number,number]=[reference[1].x,reference[1].y],p=def.reference,den=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if(Math.abs(den)>1e-10){const u=((b[0]-p[0])*(c[1]-p[1])-(b[1]-p[1])*(c[0]-p[0]))/den,v=((c[0]-p[0])*(a[1]-p[1])-(c[1]-p[1])*(a[0]-p[0]))/den,w=1-u-v,ww=[u,v,w].map(v=>Math.max(.02,v)),sum=ww.reduce((a,b)=>a+b,0),aa=point(A,current,reference,template,fallback),bb=point(B,current,reference,template,fallback),cc=[current[1].x,current[1].y];return [(ww[0]*aa[0]+ww[1]*bb[0]+ww[2]*cc[0])/sum,(ww[0]*aa[1]+ww[1]*bb[1]+ww[2]*cc[1])/sum];}
   }
  }
  if(jaw.has(def.id)){
   let best=Infinity,result:Vec|undefined;
   for(let i=0;i<oval.length;i++){const ai=oval[i],bi=oval[(i+1)%oval.length],a=reference[ai],b=reference[bi],dx=(b.x-a.x)*.8,dy=b.y-a.y,px=(def.reference[0]-a.x)*.8,py=def.reference[1]-a.y,t=Math.max(0,Math.min(1,(px*dx+py*dy)/Math.max(1e-12,dx*dx+dy*dy))),dist=(px-t*dx)**2+(py-t*dy)**2;if(dist<best){best=dist;const A=current[ai],B=current[bi];result=[A.x+(B.x-A.x)*t,A.y+(B.y-A.y)*t];}}
   if(result)return result;
  }
  return fallback(def.reference,current);
 }

export function transfer(reference:DetectedPoint[],current:DetectedPoint[],p:Vec):Vec{
 if(!reference.length||!current.length)return [...p];
 const valid=reference.map((r,i)=>finite(r)&&finite(current[i])?i:-1).filter(i=>i>=0&&i<478);if(valid.length<3)return [...p];
 if(valid.length!==Math.min(reference.length,current.length,478))return transfer(valid.map(i=>reference[i]),valid.map(i=>current[i]),p);
 const n=Math.min(reference.length,current.length,478),weights:number[]=[];let sum=0,rx=0,ry=0,tx=0,ty=0;
 for(let i=0;i<n;i++){const dx=(reference[i].x-p[0])*.8,dy=reference[i].y-p[1],d=dx*dx+dy*dy;if(d<1e-12)return [current[i].x,current[i].y];const w=1/d;weights.push(w);sum+=w;rx+=w*reference[i].x*.8;ry+=w*reference[i].y;tx+=w*current[i].x;ty+=w*current[i].y;}
 rx/=sum;ry/=sum;tx/=sum;ty/=sum;let xx=0,xy=0,yy=0,mxx=0,mxy=0,myx=0,myy=0;
 for(let i=0;i<n;i++){const x=reference[i].x*.8-rx,y=reference[i].y-ry,u=current[i].x-tx,v=current[i].y-ty,w=weights[i];xx+=w*x*x;xy+=w*x*y;yy+=w*y*y;mxx+=w*x*u;mxy+=w*x*v;myx+=w*y*u;myy+=w*y*v;}
 const det=xx*yy-xy*xy;if(Math.abs(det)<1e-12)return [tx,ty];const x=p[0]*.8-rx,y=p[1]-ry,a=(x*yy-y*xy)/det,b=(y*xx-x*xy)/det;return [tx+a*mxx+b*myx,ty+a*mxy+b*myy];
}

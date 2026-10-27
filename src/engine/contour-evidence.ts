import type {AnalysisMasks,Landmark,Mask,Region,Vec} from '../types';
import type {DetectedPoint} from './fitting';

const adjacent:Record<string,[number,number]>={p18:[162,234],p19:[389,454],p28:[127,93],p29:[356,323],p21:[93,58],p61:[132,172],p22:[58,136],p24:[136,148],p15:[148,377],p25:[365,400],p23:[288,365],p20:[323,288]};

export function sampleMask(mask:Mask|undefined,x:number,y:number):number{
 if(!mask||x<0||y<0||x>1||y>1)return 0;
 const px=x*mask.width-.5,py=y*mask.height-.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;let sum=0;
 for(let j=0;j<2;j++)for(let i=0;i<2;i++)sum+=mask.data[Math.max(0,Math.min(mask.height-1,iy+j))*mask.width+Math.max(0,Math.min(mask.width-1,ix+i))]*(i?fx:1-fx)*(j?fy:1-fy);
 return sum/255;
}

/** Accessory labels do not establish whether a lens is transparent. Keep
 * detector correspondences editable and report weak evidence for review. */
export function reviewFeatureEvidence(point:Landmark,region:Region,masks?:AnalysisMasks):Landmark{
 if(!masks?.face||!['eyes','brows','nose','mouth'].includes(region))return point;
 const face=sampleMask(masks.face,point.x,point.y),cover=Math.max(sampleMask(masks.hair,point.x,point.y),sampleMask(masks.clothing,point.x,point.y),sampleMask(masks.accessories,point.x,point.y));
 return face<.3&&cover>.65?{...point,confidence:Math.min(point.confidence,.4),review:'Hair, clothing or an accessory may cover this feature. Check its position.'}:point;
}

/** Refine only a nearby, supported face-skin exit. Covered contours keep their
 * estimate for review and leave the warp until a person places that control. */
export function reviewFaceContour(point:Landmark,current:DetectedPoint[],width:number,height:number,masks?:AnalysisMasks):Landmark{
 const indices=adjacent[point.id];if(!point.enabled||!masks?.face||!indices||!current[1]||indices.some(i=>!current[i]))return point;
 const a=current[indices[0]],b=current[indices[1]],tx=(b.x-a.x)*width,ty=(b.y-a.y)*height,length=Math.hypot(tx,ty);
 const eyeA=current[33],eyeB=current[263];if(!eyeA||!eyeB||length<1e-6)return point;
 const span=Math.hypot((eyeA.x-eyeB.x)*width,(eyeA.y-eyeB.y)*height);
 let nx=-ty/length,ny=tx/length;if(nx*(point.x-current[1].x)*width+ny*(point.y-current[1].y)*height<0){nx=-nx;ny=-ny;}
 // Measure the search and evidence footprint in face/mask units. A fixed pixel
 // cap misses the same contour when a portrait is enlarged or tightly cropped.
 const radius=Math.max(2,Math.min(span*.24,Math.min(width,height)*.14)),texel=1/Math.hypot(nx*masks.face.width/width,ny*masks.face.height/height),probe=Math.max(span*.02,texel*1.5),step=Math.min(texel*.5,radius/8),sideWidth=Math.max(span*.006,texel*.4);
 const face=sampleMask(masks.face,point.x,point.y),cover=Math.max(sampleMask(masks.hair,point.x,point.y),sampleMask(masks.body,point.x,point.y),sampleMask(masks.clothing,point.x,point.y),sampleMask(masks.accessories,point.x,point.y));
 if(face<.3&&cover>.5)return {...point,enabled:false,autoDisabled:true,confidence:.2,review:'Face boundary is covered. Place this control manually to use it.'};
 const at=(distance:number)=>{
  let value=0;for(const side of [-sideWidth,0,sideWidth])value+=sampleMask(masks.face,point.x+(nx*distance+tx/length*side)/width,point.y+(ny*distance+ty/length*side)/height);
  return value/3;
 };
 const candidates:{distance:number;strength:number}[]=[];
 const start=face>.65?0:-radius;let previous=at(start);
 for(let d=start+step;d<=radius+1e-9;d+=step){
  const value=at(d);
  if(previous>=.5&&value<.5){const distance=d-step+step*(previous-.5)/Math.max(1e-9,previous-value),strength=at(distance-probe)-at(distance+probe);if(strength>.25&&at(distance-probe)>.55&&at(distance+probe)<.4)candidates.push({distance,strength});}
  previous=value;
 }
 const best=candidates.sort((a,b)=>Math.abs(a.distance)-Math.abs(b.distance))[0];
 if(!best)return {...point,confidence:Math.min(point.confidence,.55),review:'Face boundary has weak image support. Check this control.'};
 const xy:Vec=[point.x+nx*best.distance/width,point.y+ny*best.distance/height];
 if(xy.some(v=>v<0||v>1))return point;
 return {...point,x:xy[0],y:xy[1],confidence:Math.min(.9,.7+best.strength*.2),review:undefined};
}

/** Face-skin selections can include ears. Reject a new sharp bend at the upper
 * cheek instead of treating the outside of an ear as a face correspondence. */
export function reviewContourShape(baseline:Landmark[],proposed:Landmark[],width:number,height:number):Landmark[]{
 const before=new Map(baseline.map(p=>[p.id,p])),after=new Map(proposed.map(p=>[p.id,p]));let rejected=false;
 const turn=(a:Landmark,b:Landmark,c:Landmark)=>{const u=[(b.x-a.x)*width,(b.y-a.y)*height],v=[(c.x-b.x)*width,(c.y-b.y)*height],length=Math.hypot(...u)*Math.hypot(...v);return length>1e-9?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/length))):0;};
 const neighbors:Record<string,[string,string]>={p28:['p18','p21'],p29:['p20','p19']};
 const reviewed=proposed.map(p=>{
  const pair=neighbors[p.id],original=before.get(p.id);if(!pair||!original||!p.enabled||p.authored||p.locked||(p.x===original.x&&p.y===original.y))return p;
  const [a,c]=pair.map(id=>before.get(id)),[A,C]=pair.map(id=>after.get(id));if(!a||!c||!A||!C)return p;
  if(turn(A,p,C)<=Math.max(.6,turn(a,original,c)+.35))return p;
  rejected=true;return {...p,x:original.x,y:original.y,confidence:Math.min(p.confidence,.55),review:'Skin selection has an abrupt upper-cheek bend. Detector position kept; check this control.'};
 });
 return rejected?reviewed:proposed;
}

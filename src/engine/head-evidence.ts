import type {AnalysisMasks,Mask,Vec} from '../types';
import type {DetectedPoint} from './fitting';
import {sampleMask} from './contour-evidence';

/** Use the same stored class evidence for cached and newly detected photos. */
export function headMaskFromAnalysis(masks?:AnalysisMasks):Mask|undefined{
 const layers=[masks?.face,masks?.hair,masks?.accessories].filter((m):m is Mask=>!!m);
 if(!masks?.face||!masks.hair||!layers.length)return;
 const {width,height}=masks.face;
 return {width,height,data:Uint8Array.from({length:width*height},(_,i)=>Math.round(255*Math.min(1,layers.reduce((sum,m)=>sum+(m.width===width&&m.height===height?m.data[i]/255:sampleMask(m,(i%width+.5)/width,(Math.floor(i/width)+.5)/height)),0))))};
}

/** Locate the visible forehead opening near its existing center ray. Hair and
 * headwear edges need a face-to-cover transition, not an outside subject edge. */
export function reviewFrontOpening(seed:Vec,current:DetectedPoint[],width:number,height:number,masks:AnalysisMasks):{point:Vec;supported:boolean}{
 const face=masks.face,a=current[33],b=current[263],nose=current[1];
 if(!face||!a||!b||!nose||[a,b,nose].some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return {point:seed,supported:false};
 const span=Math.hypot((b.x-a.x)*width,(b.y-a.y)*height),dx=(seed[0]-nose.x)*width,dy=(seed[1]-nose.y)*height,length=Math.hypot(dx,dy);
 if(span<4||length<span*.25)return {point:seed,supported:false};
 const nx=dx/length,ny=dy/length,texel=1/Math.hypot(nx*face.width/width,ny*face.height/height),step=Math.max(.5,texel*.5),side=Math.max(span*.025,texel);
 const at=(d:number)=>{let sum=0;for(const s of [-side,0,side])sum+=sampleMask(face,nose.x+(nx*d-ny*s)/width,nose.y+(ny*d+nx*s)/height);return sum/3;};
 let previous=at(length*.55);
 for(let d=length*.55+step;d<=length+span*.25;d+=step){const value=at(d);if(previous>=.5&&value<.5){
   const distance=d-step+step*(previous-.5)/Math.max(1e-9,previous-value),probe=Math.max(texel*1.5,span*.025),p:Vec=[nose.x+nx*distance/width,nose.y+ny*distance/height];
   const cover=Math.max(sampleMask(masks.hair,p[0]+nx*probe/width,p[1]+ny*probe/height),sampleMask(masks.clothing,p[0]+nx*probe/width,p[1]+ny*probe/height),sampleMask(masks.accessories,p[0]+nx*probe/width,p[1]+ny*probe/height));
   if(p.every(v=>v>0&&v<1)&&at(distance-probe)>.65&&at(distance+probe)<.35&&cover>.5)return {point:p,supported:true};
  }previous=value;}
 return {point:seed,supported:false};
}

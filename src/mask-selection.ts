import type {AnalysisMasks,Mask} from './types';
import {sampleMask} from './engine/contour-evidence';

/** Merge a cached semantic selection into the editable contribution mask.
 * Min makes repeated application idempotent and keeps existing brush removals. */
export function excludeSelection(selection:Mask,previous:Mask|undefined,width:number,height:number,kind:'hair'|'accessories'='accessories',classes?:AnalysisMasks):Mask{
 const scale=Math.min(1,512/Math.max(width,height)),w=previous?.width??Math.max(1,Math.round(width*scale)),h=previous?.height??Math.max(1,Math.round(height*scale)),data=new Uint8Array(w*h);
 const layers=classes&&(['face','hair','body','clothing','accessories'] as const).map(key=>classes[key]);
 const complete=layers?.every((layer):layer is Mask=>!!layer);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const px=(x+.5)/w,py=(y+.5)/h,selected=sampleMask(selection,px,py);
  // Subject alpha already contains foreground probability. At a hair/background
  // edge, multiplying it by (1 - hair probability) leaves a dark fringe. Remove
  // the selected fraction of the foreground instead.
  const foreground=complete?layers.reduce((sum,layer)=>sum+sampleMask(layer,px,py),0):1,probability=foreground>1e-6?Math.min(1,selected/foreground):0;
  const low=kind==='hair'?.1:.3,t=Math.max(0,Math.min(1,(probability-low)/(.8-low))),remove=t*t*(3-2*t),keep=1-remove;
  data[y*w+x]=Math.round(255*Math.min(previous?sampleMask(previous,px,py):1,keep));
 }
 return {width:w,height:h,data};
}

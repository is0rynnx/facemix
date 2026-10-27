import type {Mask} from './types';
import {sampleMask} from './engine/contour-evidence';

/** Merge a cached semantic selection into the editable contribution mask.
 * Min makes repeated application idempotent and keeps existing brush removals. */
export function excludeSelection(selection:Mask,previous:Mask|undefined,width:number,height:number):Mask{
 const scale=Math.min(1,512/Math.max(width,height)),w=previous?.width??Math.max(1,Math.round(width*scale)),h=previous?.height??Math.max(1,Math.round(height*scale)),data=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const px=(x+.5)/w,py=(y+.5)/h,probability=sampleMask(selection,px,py),t=Math.max(0,Math.min(1,(probability-.3)/.5)),remove=t*t*(3-2*t),keep=1-remove;
  data[y*w+x]=Math.round(255*Math.min(previous?sampleMask(previous,px,py):1,keep));
 }
 return {width:w,height:h,data};
}

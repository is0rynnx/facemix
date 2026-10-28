import type {Mask} from '../types';
interface Pixels {width:number;height:number;data:ArrayLike<number>;}
const cache=new WeakMap<object,Map<number,Pixels>>();
/** A bounded separable box filter. It softens painted feature edges once per mask revision. */
export function featherFeatureMask(mask:Pixels,amount:number):Pixels{
 const radius=Math.max(0,amount)*Math.max(mask.width,mask.height);if(!radius)return mask;
 let entries=cache.get(mask);const found=entries?.get(radius);if(found)return found;
 const {width:w,height:h}=mask,a=new Float32Array(w*h),b=new Float32Array(w*h),whole=Math.floor(radius),fraction=radius-whole,span=radius*2+1;
 const at=(x:number,y:number)=>mask.data[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];
 for(let y=0;y<h;y++){let sum=0;for(let x=-whole;x<=whole;x++)sum+=at(x,y);for(let x=0;x<w;x++){a[y*w+x]=(sum+fraction*(at(x-whole-1,y)+at(x+whole+1,y)))/span;sum+=at(x+whole+1,y)-at(x-whole,y);}}
 const filtered=(x:number,y:number)=>a[Math.max(0,Math.min(h-1,y))*w+x];
 for(let x=0;x<w;x++){let sum=0;for(let y=-whole;y<=whole;y++)sum+=filtered(x,y);for(let y=0;y<h;y++){b[y*w+x]=(sum+fraction*(filtered(x,y-whole-1)+filtered(x,y+whole+1)))/span;sum+=filtered(x,y+whole+1)-filtered(x,y-whole);}}
 const result={width:w,height:h,data:b};if(!entries){entries=new Map();cache.set(mask,entries);}if(entries.size>=2)entries.delete(entries.keys().next().value!);entries.set(radius,result);return result;
}

const contributionCache=new WeakMap<Mask,{radius:number;mask:Mask}>();

/** Smooth the mask once, in its own coordinates. The stored brush mask stays
 * unchanged, and the CPU, GPU and editor use the same edge values. */
export function featherMask(mask:Mask|undefined,radius=0):Mask|undefined{
 if(!mask||!Number.isFinite(radius)||radius<=0)return mask;
 radius=Math.min(12,radius);const hit=contributionCache.get(mask);if(hit?.radius===radius)return hit.mask;
 const sigma=Math.max(.25,radius/2),reach=Math.ceil(sigma*3),weights=Float64Array.from({length:reach*2+1},(_,i)=>Math.exp(-.5*((i-reach)/sigma)**2)),sum=weights.reduce((a,b)=>a+b,0);
 for(let i=0;i<weights.length;i++)weights[i]/=sum;
 const {width,height}=mask,horizontal=new Float32Array(width*height),data=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(let k=-reach;k<=reach;k++)value+=mask.data[y*width+Math.max(0,Math.min(width-1,x+k))]*weights[k+reach];horizontal[y*width+x]=value;}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(let k=-reach;k<=reach;k++)value+=horizontal[Math.max(0,Math.min(height-1,y+k))*width+x]*weights[k+reach];data[y*width+x]=Math.round(value);}
 const result={width,height,data};contributionCache.set(mask,{radius,mask:result});return result;
}

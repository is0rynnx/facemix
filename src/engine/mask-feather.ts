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

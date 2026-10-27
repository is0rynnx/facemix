import type {AnalysisMasks,DetectionResult,Landmark,Mask,Source,Vec} from './types';

export function faceCropBounds(bounds:[number,number,number,number],width:number,height:number):[number,number,number,number]{
 const [x,y,r,b]=bounds,w=Math.max(.01,r-x),h=Math.max(.01,b-y),cx=(x+r)/2;
 return [Math.max(0,Math.floor((cx-w)*width))/width,Math.max(0,Math.floor((y-h*.5)*height))/height,Math.min(width,Math.ceil((cx+w)*width))/width,Math.min(height,Math.ceil((b+h*.9)*height))/height];
}
export function cropCoordinates<T extends {x:number;y:number}>(points:T[],rect:[number,number,number,number]):T[]{const [x,y,r,b]=rect;return points.map(p=>({...p,x:(p.x-x)/(r-x),y:(p.y-y)/(b-y)}));}
function cropLandmarks(points:Landmark[],rect:[number,number,number,number]):Landmark[]{return cropCoordinates(points,rect).map(p=>p.authored||p.locked||!p.enabled||p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1?p:{...p,enabled:false,confidence:.15});}
function cropFeatures(points:Source['featurePoints'],rect:[number,number,number,number]):Source['featurePoints']{const[x,y,r,b]=rect;return points?Object.fromEntries(Object.entries(points).map(([id,p])=>[id,[(p[0]-x)/(r-x),(p[1]-y)/(b-y)] as Vec])):undefined;}
export function cropMask(mask:Mask|undefined,rect:[number,number,number,number]):Mask|undefined{
 if(!mask)return;const [x,y,r,b]=rect,width=Math.max(1,Math.round((r-x)*mask.width)),height=Math.max(1,Math.round((b-y)*mask.height)),data=new Uint8Array(width*height);
 for(let j=0;j<height;j++)for(let i=0;i<width;i++){const u=(x+(i+.5)/width*(r-x))*mask.width-.5,v=(y+(j+.5)/height*(b-y))*mask.height-.5,ix=Math.floor(u),iy=Math.floor(v);let n=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)n+=mask.data[Math.min(mask.height-1,Math.max(0,iy+dy))*mask.width+Math.min(mask.width-1,Math.max(0,ix+dx))]*(dx?u-ix:1-u+ix)*(dy?v-iy:1-v+iy);data[j*width+i]=Math.round(n);}
 return {width,height,data};
}

export function cropAnalysisMasks(masks:AnalysisMasks|undefined,rect:[number,number,number,number]):AnalysisMasks|undefined{return masks?Object.fromEntries(Object.entries(masks).map(([key,mask])=>[key,cropMask(mask,rect)])):undefined;}
export function cropDetection(result:DetectionResult,rect:[number,number,number,number]):DetectionResult{
 return {...result,landmarks:cropLandmarks(result.landmarks,rect),featurePoints:cropFeatures(result.featurePoints,rect),mask:cropMask(result.mask,rect),analysisMasks:cropAnalysisMasks(result.analysisMasks,rect),faces:undefined};
}
export function cropSourceCoordinates(source:Source,rect:[number,number,number,number]):Source{return {...source,width:Math.round((rect[2]-rect[0])*source.width),height:Math.round((rect[3]-rect[1])*source.height),landmarks:cropLandmarks(source.landmarks,rect),featurePoints:cropFeatures(source.featurePoints,rect),subjectMask:cropMask(source.subjectMask,rect),exclusionMask:cropMask(source.exclusionMask,rect),analysisMasks:cropAnalysisMasks(source.analysisMasks,rect)};}

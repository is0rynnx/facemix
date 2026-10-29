import type {Vec} from '../types';

type Observation={x:number;y:number};
// MediaPipe eye contours, ordered from image-left to image-right.
export const eyePaths={
 leftUpper:[33,246,161,160,159,158,157,173,133],
 leftLower:[33,7,163,144,145,153,154,155,133],
 rightUpper:[362,398,384,385,386,387,388,466,263],
 rightLower:[362,382,381,380,374,373,390,249,263]
};
const samples:Record<string,[keyof typeof eyePaths,number]>={
 'lid-160':['leftUpper',.25],'lid-159':['leftUpper',.5],'lid-158':['leftUpper',.75],
 'lid-144':['leftLower',.25],'lid-145':['leftLower',.5],'lid-153':['leftLower',.75],
 'lid-385':['rightUpper',.25],'lid-386':['rightUpper',.5],'lid-387':['rightUpper',.75],
 'lid-380':['rightLower',.25],'lid-374':['rightLower',.5],'lid-373':['rightLower',.75]
};
export const irisVertices:Record<string,number>={p30:468,p34:471,p35:469,p36:470,'iris-472':472,p31:473,p32:476,p33:474,p37:475,'iris-477':477};
export const eyelidContours=[
 {name:'Left eyelid',ids:['p04','lid-160','lid-159','lid-158','p01','lid-153','lid-145','lid-144'],closed:true},
 {name:'Right eyelid',ids:['p02','lid-385','lid-386','lid-387','p03','lid-373','lid-374','lid-380'],closed:true}
];

/** Sample equal fractions of a visible curve in pixel coordinates. This keeps
 * asymmetric eyes asymmetric and does not fit a generic ellipse. */
export function arcPoint(path:Vec[],fraction:number,aspect:number):Vec|undefined{
 if(path.length<2||!Number.isFinite(aspect)||aspect<=0||path.some(p=>!p||p.some(v=>!Number.isFinite(v))))return;
 const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths[i-1]+Math.hypot((path[i][0]-path[i-1][0])*aspect,path[i][1]-path[i-1][1]));
 const total=lengths.at(-1)!;if(total<1e-8)return;
 const distance=Math.max(0,Math.min(1,fraction))*total;let i=1;while(i<lengths.length-1&&lengths[i]<distance)i++;
 const t=(distance-lengths[i-1])/Math.max(1e-12,lengths[i]-lengths[i-1]);return [path[i-1][0]+t*(path[i][0]-path[i-1][0]),path[i-1][1]+t*(path[i][1]-path[i-1][1])];
}
export function eyePoint(id:string,current:Observation[],aspect:number):Vec|undefined{
 const sample=samples[id];if(sample){const path=eyePaths[sample[0]].map(i=>current[i]);if(path.some(p=>!p))return;return arcPoint(path.map(p=>[p.x,p.y]),sample[1],aspect);}
 const index=irisVertices[id],p=index===undefined?undefined:current[index];return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?[p.x,p.y]:undefined;
}

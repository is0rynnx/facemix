import type {Recipe,Vec} from '../types';

export const FACE_EDIT_GROUPS=[
 {name:'Eyes',controls:[['eyeSize','Eye size'],['eyeHeight','Eye height'],['eyeWidth','Eye width'],['eyeSpacing','Eye spacing'],['eyeTilt','Eye tilt'],['eyeVertical','Eye position']]},
 {name:'Brows',controls:[['browHeight','Brow height'],['browSpacing','Brow spacing'],['browArch','Brow arch'],['browTilt','Brow tilt']]},
 {name:'Nose',controls:[['noseWidth','Nose width'],['noseLength','Nose length'],['nostrilWidth','Nostril width']]},
 {name:'Mouth',controls:[['mouthWidth','Mouth width'],['lipHeight','Lip height'],['upperLipHeight','Upper lip height'],['lowerLipHeight','Lower lip height'],['mouthVertical','Mouth position'],['smile','Mouth corner height']]},
 {name:'Face',controls:[['faceWidth','Face width'],['faceHeight','Face height'],['templeWidth','Temple width'],['cheekWidth','Cheek width'],['jawWidth','Jaw width'],['chinWidth','Chin width'],['chinHeight','Chin height'],['foreheadHeight','Forehead height']]}
] as const;
export type FaceEdit=typeof FACE_EDIT_GROUPS[number]['controls'][number][0];
export type FaceEdits=Partial<Record<FaceEdit,number>>;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/Math.max(1e-8,b-a)));return t*t*(3-2*t);};

/** Edits use the unedited 2D measurements. Pins are applied afterwards.
 * Eye width/height change the opening, not the iris aspect ratio.
 * These controls do not reconstruct hidden anatomy. */
export function editFaceShape(ids:string[],base:Vec[],recipe:Recipe):Vec[]{
 const edits=recipe.faceEdits;
 if(!edits||!Object.values(edits).some(v=>Number.isFinite(v)&&v!==0))return base;
 const v=(key:FaceEdit)=>Math.max(-100,Math.min(100,Number.isFinite(edits[key])?edits[key]!:0))/100;
 const points=new Map(ids.map((id,i)=>[id,base[i]])),get=(id:string,f:Vec)=>points.get(id)??f;
 const mid=(a:Vec,b:Vec):Vec=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
 const left=mid(get('p01',[.35,.42]),get('p04',[.3,.42])),right=mid(get('p02',[.45,.42]),get('p03',[.5,.42]));
 const eyeMid=mid(left,right),distance=Math.max(.02,Math.hypot(right[0]-left[0],right[1]-left[1]));
 const nose=get('p12',eyeMid),mouth=mid(get('p16',[.34,.58]),get('p17',[.46,.58])),chin=get('p15',[eyeMid[0],.69]);
 const eyeSets=[new Set(['p01','p04','p30','p34','p35','p36','iris-468','iris-469','iris-471','iris-472','lid-159','lid-145','lid-160','lid-158','lid-144','lid-153']),new Set(['p02','p03','p31','p32','p33','p37','iris-473','iris-474','iris-476','iris-477','lid-386','lid-374','lid-385','lid-387','lid-380','lid-373'])];
 const brows=new Set(['p05','p06','p07','p08','p09','p10','p60']),noseIds=new Set(['p11','p12','p13','p14','p55']),mouthIds=new Set(['p16','p17','p38','p39','p40']);
 const faceIds=new Set(['p15','p18','p19','p20','p21','p22','p23','p24','p25','p26','p27','p28','p29','p46','p56','p57','p58','p59','p61']);
 return base.map(([bx,by],i)=>{
  const id=ids[i];let x=bx,y=by;
  const side=eyeSets.findIndex(set=>set.has(id));
  if(side>=0){
   const c=side===0?left:right,inner=get(side===0?'p01':'p02',c),outer=get(side===0?'p04':'p03',c);
   const length=Math.max(.005,Math.hypot(inner[0]-outer[0],inner[1]-outer[1])),ux=(inner[0]-outer[0])/length*(side===0?1:-1),uy=(inner[1]-outer[1])/length*(side===0?1:-1);
   let dx=(bx-c[0])*ux+(by-c[1])*uy,dy=-(bx-c[0])*uy+(by-c[1])*ux;
   const size=1+.14*v('eyeSize'),opening=id.startsWith('lid-')||['p01','p02','p03','p04'].includes(id);
   dx*=size*(opening?1+.16*v('eyeWidth'):1);
   dy*=size*(id.startsWith('lid-')?1+.24*v('eyeHeight'):1);
   const angle=v('eyeTilt')*.085*(side===0?-1:1),rx=dx*Math.cos(angle)-dy*Math.sin(angle),ry=dx*Math.sin(angle)+dy*Math.cos(angle);
   x=c[0]+rx*ux-ry*uy+(side===0?-1:1)*distance*.055*v('eyeSpacing');
   y=c[1]+rx*uy+ry*ux-distance*.035*v('eyeVertical');
  }
  if(brows.has(id)){
   const isLeft=['p07','p08','p09'].includes(id),center=mid(get(isLeft?'p07':'p05',[bx,by]),get(isLeft?'p08':'p06',[bx,by])),angle=(isLeft?1:-1)*.075*v('browTilt'),dx=bx-center[0],dy=by-center[1];
   x=center[0]+dx*Math.cos(angle)-dy*Math.sin(angle)+(isLeft?-1:1)*distance*.035*v('browSpacing');
   y=center[1]+dx*Math.sin(angle)+dy*Math.cos(angle)-distance*.055*v('browHeight')-(['p09','p10'].includes(id)?distance*.025*v('browArch'):0);
  }
  if(noseIds.has(id)||id.startsWith('ala-')){x=nose[0]+(bx-nose[0])*(1+.16*v('noseWidth'));y=nose[1]+(by-nose[1])*(1+.12*v('noseLength'));}
  if(['p13','p14'].includes(id)||id.startsWith('ala-'))x=nose[0]+(x-nose[0])*(1+.12*v('nostrilWidth'));
  if(mouthIds.has(id)||id.startsWith('lip-')){
   x=mouth[0]+(bx-mouth[0])*(1+.16*v('mouthWidth'));
   y=mouth[1]+(by-mouth[1])*(1+.18*v('lipHeight'));
   const width=Math.max(.01,Math.abs(get('p17',mouth)[0]-get('p16',mouth)[0])/2),corner=Math.min(1,Math.abs(bx-mouth[0])/width);
   y-=distance*.035*v('smile')*(.2+.8*corner*corner);
   if(['p38','p39','lip-0','lip-37','lip-267'].includes(id))y+=Math.min(0,by-mouth[1])*.22*v('upperLipHeight');
   if(['p40','lip-17','lip-84','lip-314'].includes(id))y+=Math.max(0,by-mouth[1])*.22*v('lowerLipHeight');
   y-=distance*.035*v('mouthVertical');
  }
  if(['p18','p19','p26','p27'].includes(id))x+=(bx-eyeMid[0])*.06*v('templeWidth');
  if(['p20','p21','p28','p29','p61','jaw-93','jaw-323'].includes(id))x+=(bx-eyeMid[0])*.065*v('cheekWidth');
  if(['p15','p24','p25','p46','jaw-150','jaw-149','jaw-176','jaw-400','jaw-379','jaw-378'].includes(id))x+=(bx-eyeMid[0])*.09*v('chinWidth');
  if(faceIds.has(id)||id.startsWith('jaw-')){
   const lower=smooth(eyeMid[1],chin[1],by),jawBand=smooth(eyeMid[1]+(mouth[1]-eyeMid[1])*.35,mouth[1],by)*(1-.65*smooth(mouth[1],chin[1],by));
   const support=id==='p56'?.4:id==='p46'?.65:id==='p58'||id==='p59'?.6:1;
   x+=(bx-eyeMid[0])*(.075*v('faceWidth')+.10*v('jawWidth')*jawBand)*support;
   y+=distance*.055*v('chinHeight')*lower*support;
  }
  if(['p42','p43','p44','p45'].includes(id)){
   const anchor=get(id==='p44'||id==='p45'?'p21':'p20',[bx,by]),band=smooth(eyeMid[1]+(mouth[1]-eyeMid[1])*.35,mouth[1],anchor[1])*(1-.65*smooth(mouth[1],chin[1],anchor[1]));
   // Translate each ear with its cheek attachment. A fixed ear can invert the cheek edge.
   x+=(anchor[0]-eyeMid[0])*(.075*v('faceWidth')+.10*Math.max(0,v('jawWidth'))*band)*.7;
  }
  if(['p26','p27','p41','p47','p48','p49','p51','p53','p54','p57'].includes(id))y-=Math.max(0,eyeMid[1]-by)*.09*v('foreheadHeight');
  y=eyeMid[1]+(y-eyeMid[1])*(1+.07*v('faceHeight'));
  return [x,y] as Vec;
 });
}

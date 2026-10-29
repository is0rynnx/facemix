import type {Project,Variant} from './types';

const layoutNames=new Set(['Control layout backup','Before measured feature detail','Before restoring original controls','Before keypoint layout']);
export function isRecovery(variant:Variant):boolean{return variant.kind?variant.kind==='recovery':layoutNames.has(variant.name)||/^(?:Before landmark fit v|Landmark backup )\d+$/.test(variant.name);}
export function savedVariants(variants:Variant[]):Variant[]{return variants.filter(variant=>!isRecovery(variant));}
export function nextVariantName(variants:Variant[]):string{let number=1;const names=new Set(savedVariants(variants).map(v=>v.name));while(names.has(`Variant ${number}`))number++;return `Variant ${number}`;}

/** Retain recovery data without listing it as a user-saved variant. */
export function classifyRecoveries(project:Project):Project{
 let changed=false;const variants=project.variants.map(variant=>{if(variant.kind||!isRecovery(variant))return variant;changed=true;return {...variant,kind:'recovery' as const};});
 return changed?{...project,variants}:project;
}

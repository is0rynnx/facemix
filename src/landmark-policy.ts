import type {PointDefinition,Project,Recipe} from './types';

/** One layout. The old mode field is ignored when reading legacy projects. */
export function usesControl(def:Pick<PointDefinition,'region'>&Partial<Pick<PointDefinition,'id'>>,recipe:Pick<Recipe,'earControls'|'hairControls'>):boolean{
 if(def.id==='p41')return true;
 if(def.region==='hair')return recipe.hairControls===true;
 if(def.region==='ears')return recipe.earControls!==false;
 return def.id!=='p58'&&def.id!=='p59';
}

/** A neck estimate is not a measured section of the visible jaw. */
export function faceContourIds(ids:string[],points:PointDefinition[]):string[]{
 return ids.filter(id=>points.find(p=>p.id===id)?.region==='outline');
}

export function activeControlCount(project:Project):number{
 const sources=project.sources.filter(s=>s.enabled);
 return project.template.points.filter(d=>usesControl(d,project.recipe)&&sources.every(s=>s.landmarks.some(p=>p.id===d.id&&p.enabled))).length;
}

export function relevantLandmarkNotes(note:string|undefined,recipe:Recipe):string|undefined{
 if(!note)return note;
 const regions=[...(recipe.hairControls===true?['Hair']:[]),...(recipe.earControls!==false?['ears']:[]),'forehead'];
 return note.replace('Hair, ears, forehead and neck need review',`${regions.join(', ')} controls need review`);
}

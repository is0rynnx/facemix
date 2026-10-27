import type {Project,Source} from './types';

/** Keep recipe references attached to a photo when preparation creates a new asset. */
export function replaceSource(project:Project,sourceId:string,next:Source):Project {
 const regionSources=project.recipe.regionSources?Object.fromEntries(Object.entries(project.recipe.regionSources).map(([region,donors])=>[region,{...donors,shape:donors.shape===sourceId?next.id:donors.shape,appearance:donors.appearance===sourceId?next.id:donors.appearance}])):undefined;
 return {...project,sources:project.sources.map(source=>source.id===sourceId?next:source),recipe:{...project.recipe,regionSources,backgroundSourceId:project.recipe.backgroundSourceId===sourceId?next.id:project.recipe.backgroundSourceId}};
}

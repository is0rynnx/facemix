export interface LibrarySelection {selected:string[];anchor?:string;focused?:string;}
export interface SelectionModifiers {ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean;toggle?:boolean;}
export function selectLibrary(state:LibrarySelection,ordered:string[],id:string,keys:SelectionModifiers={}):LibrarySelection{
 if(!ordered.includes(id))return state;
 const additive=keys.ctrlKey||keys.metaKey||keys.toggle,anchor=state.anchor&&ordered.includes(state.anchor)?state.anchor:id;
 if(keys.shiftKey){const a=ordered.indexOf(anchor),b=ordered.indexOf(id),range=ordered.slice(Math.min(a,b),Math.max(a,b)+1);return {selected:additive?[...new Set([...state.selected,...range])]:range,anchor,focused:id};}
 return {selected:additive?(state.selected.includes(id)?state.selected.filter(p=>p!==id):[...state.selected,id]):[id],anchor:id,focused:id};
}
export function selectAllLibrary(ordered:string[]):LibrarySelection{return {selected:[...ordered],anchor:ordered[0],focused:ordered.at(-1)};}
export function libraryTextTarget(target:EventTarget|null):boolean{return target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');}

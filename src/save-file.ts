import {download} from './data';
type FileHandle={createWritable:()=>Promise<{write:(blob:Blob)=>Promise<void>;close:()=>Promise<void>}>};
type Picker=(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<FileHandle>;
/** Request the destination during the click, before asynchronous rendering starts. */
export async function choosePNGFile(name:string):Promise<((blob:Blob)=>Promise<void>)|undefined>{
 const picker=(window as unknown as {showSaveFilePicker?:Picker}).showSaveFilePicker;
 if(!picker)return async blob=>download(blob,name);
 try{const handle=await picker.call(window,{suggestedName:name,types:[{description:'PNG image',accept:{'image/png':['.png']}}]});return async blob=>{const file=await handle.createWritable();await file.write(blob);await file.close();};}
 catch(error){if((error as DOMException).name==='AbortError')return;throw error;}
}

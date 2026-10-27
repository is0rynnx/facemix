const imageFile=(file:File)=>file.type.startsWith('image/')||/\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);

export function clipboardPhotos(data:Pick<DataTransfer,'files'|'items'>|null):File[]{
 if(!data)return [];
 const files=Array.from(data.files??[]).filter(imageFile);
 if(files.length)return files;
 return Array.from(data.items??[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
}

export function photoPasteTarget(target:EventTarget|null):boolean{
 return target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
}

export async function readClipboardPhotos(read:()=>Promise<ClipboardItems>):Promise<File[]>{
 const items=await read(),files:File[]=[];
 for(const item of items){const type=item.types.includes('image/png')?'image/png':item.types.find(type=>type.startsWith('image/'));if(!type)continue;const blob=await item.getType(type),extension=type.split('/')[1].replace('jpeg','jpg');files.push(new File([blob],`Pasted photo ${files.length+1}.${extension}`,{type}));}
 return files;
}

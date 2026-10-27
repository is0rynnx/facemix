import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'public/models'); await mkdir(out,{recursive:true});
const files=[
 ['face_landmarker.task','https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
 ['selfie_multiclass.tflite','https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite']
];
const manifest={mediapipe:'0.10.32',files:[]};
for(const [name,url] of files){
 let data; try{data=await readFile(resolve(out,name));}catch{
  console.log(`Downloading ${name}`);const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);
  data=Buffer.from(await response.arrayBuffer());await writeFile(resolve(out,name),data);
 }
 const hash=createHash('sha256').update(data).digest('hex');manifest.files.push({name,url,sha256:hash,bytes:data.length});console.log(`${name}: ${data.length} bytes, SHA-256 ${hash}`);
}
for(const name of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm']){
 await copyFile(resolve(root,'node_modules/@mediapipe/tasks-vision/wasm',name),resolve(out,name));
 const data=await readFile(resolve(out,name));manifest.files.push({name,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
}
await copyFile(resolve(root,'node_modules/@mediapipe/tasks-vision/vision_bundle.cjs'),resolve(out,'vision_bundle.js'));
const bundle=await readFile(resolve(out,'vision_bundle.js'));manifest.files.push({name:'vision_bundle.js',sha256:createHash('sha256').update(bundle).digest('hex'),bytes:bundle.length});
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');

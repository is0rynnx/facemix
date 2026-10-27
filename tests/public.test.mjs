import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

test('reads clipboard image files without duplicates',async()=>{
 const result=await build({entryPoints:['src/photo-paste.ts'],bundle:true,platform:'node',format:'esm',write:false}),P=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const image=new File(['pixels'],'photo.png',{type:'image/png'}),item={kind:'file',type:'image/png',getAsFile:()=>image};
 assert.deepEqual(P.clipboardPhotos({files:[image],items:[item]}),[image]);assert.deepEqual(P.clipboardPhotos({files:[],items:[item]}),[image]);
 const files=await P.readClipboardPhotos(async()=>[{types:['image/png','image/jpeg'],getType:async type=>new Blob(['pixels'],{type})}]);assert.equal(files.length,1);assert.equal(files[0].type,'image/png');
});
test('validates the library assets',async()=>{
 const catalog=JSON.parse(await fs.readFile('public/library/catalog.json','utf8'));
 assert.equal(catalog.entries.length,492);assert(catalog.entries.every(e=>e.id.startsWith('phenotypes-')&&!e.source));
 const allowed=new Set();for(const entry of catalog.entries)for(const key of ['url','thumbnail','mask','preparation']){assert(/^(library\/phenotypes\/|library\/prepared\/phenotypes-)/.test(entry[key]));await fs.stat('public/'+entry[key]);allowed.add(entry[key]);}
 const inventory=JSON.parse(await fs.readFile('public/PUBLIC_ASSETS.json','utf8'));assert.deepEqual([...allowed].sort(),inventory.allowedLibraryFiles);
 const fixture=JSON.parse(await fs.readFile('public/demo/fixture.json','utf8'));assert(fixture.sources.every(s=>allowed.has(s.url)&&allowed.has(s.mask)));
});
test('checks the model files',async()=>{
 const manifest=JSON.parse(await fs.readFile('public/models/manifest.json','utf8'));
 for(const file of manifest.files){const data=await fs.readFile('public/models/'+file.name);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.name);}
 const worker=await fs.readFile('public/workers/inference.worker.js','utf8');assert(!/https?:\/\//.test(worker));assert(worker.includes("m.base+'models/face_landmarker.task'"));
});
test('checks the reference data and mesh geometry',async()=>{
 const calibration=JSON.parse(await fs.readFile('src/detector-calibration.json','utf8')),catalog=JSON.parse(await fs.readFile('public/library/catalog.json','utf8'));
 const publicFace=JSON.parse(await fs.readFile('public/library/prepared/phenotypes-faces-annamidf.jpg.json','utf8'));
 for(let i=0;i<478;i++){const p=publicFace.featurePoints['mp-'+i];assert.equal(calibration[i][0],.5+(p[0]-.5)*(publicFace.width/publicFace.height)/.8);assert.equal(calibration[i][1],p[1]);}
 const result=await build({stdin:{contents:"export * from './src/engine/math.ts';export * from './src/measured-detail.ts';export * from './src/types.ts';export * from './src/responsive.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/public-engine.mjs',result.outputFiles[0].text);const F=await import(pathToFileURL(process.cwd()+'/test-results/public-engine.mjs'));
 const fixture=JSON.parse(await fs.readFile('public/demo/fixture.json','utf8')),sources=await Promise.all(fixture.sources.map(async(s,i)=>{const entry=catalog.entries.find(e=>e.url===s.url),prepared=JSON.parse(await fs.readFile('public/'+entry.preparation,'utf8'));return {...prepared,id:String(i),landmarks:s.preparedLandmarks,featurePoints:s.featurePoints,regionWeights:F.regionDefaults()};}));
 assert.equal(F.defaultRecipe().cropFeather*2048,4);assert.equal(F.defaultRecipe().hairControls,false);assert.equal(F.previewSize(390,1),512);assert.equal(F.previewSize(390,2),768);assert.equal(F.previewSize(1440,2),2048);
 for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++)for(const weight of [.25,.5,.75])for(const hairControls of [false,true]){
  const p=F.withMeasuredDetail({schemaVersion:1,id:'test',name:'test',revision:0,sources:[{...sources[i],shapeWeight:1-weight},{...sources[j],shapeWeight:weight}],template:fixture.template,recipe:{...F.defaultRecipe(),earControls:false,hairControls},variants:[]});
  const mesh=await F.buildMesh({...p,size:256,quality:'preview'},()=>false);assert(!mesh.controls.diagnostics.some(d=>d.kind==='error'||d.code==='folded-cells'));assert(mesh.uvs.flat(2).every(Number.isFinite));
  for(const point of p.template.points.filter(d=>d.region==='hair'))assert.equal(mesh.controls.ids.includes(point.id),hairControls);
  assert.notEqual(F.geometrySignature(p),F.geometrySignature({...p,recipe:{...p.recipe,hairControls:!hairControls}}));
 }
});

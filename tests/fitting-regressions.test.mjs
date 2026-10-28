import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {loadImage,createCanvas} from '@napi-rs/canvas';

const compiled=await build({stdin:{contents:"export * from './src/engine/fitting';export * from './src/engine/contour-evidence';export * from './src/engine/visible-contour';export * from './src/engine/head-evidence';export * from './src/engine/quadratic-minima';export * from './src/features';export * from './src/engine/math';export * from './src/types';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/fitting-regressions.mjs',compiled.outputFiles[0].text);
const F=await import(pathToFileURL(process.cwd()+'/test-results/fitting-regressions.mjs'));
const calibration=JSON.parse(await fs.readFile('src/detector-calibration.json','utf8')),reference=calibration.map(([x,y])=>({x,y})),original=JSON.parse(await fs.readFile('src/reference-template.json','utf8')),template={...original,id:'face-controls',points:original.points.filter(d=>!['p56','p58','p59','p60'].includes(d.id))};
const mask=(width,height,predicate)=>({width,height,data:Uint8Array.from({length:width*height},(_,i)=>predicate((i%width+.5)/width,(Math.floor(i/width)+.5)/height)?255:0)});

test('quadratic contour search has the same minima as an exhaustive search',()=>{
 let random=13;const next=()=>((random=Math.imul(random,1664525)+1013904223>>>0)/2**32);
 for(const scale of [.0001,.1,1,100])for(let trial=0;trial<100;trial++){
  const costs=Float64Array.from({length:97},()=>next()*50),indices=F.quadraticMinima(costs,scale);
  for(let j=0;j<costs.length;j++){let best=Infinity,index=0;for(let k=0;k<costs.length;k++){const value=costs[k]+scale*(j-k)**2;if(value<best){best=value;index=k;}}assert.equal(indices[j],index);}
 }
 assert.deepEqual([...F.quadraticMinima(new Float64Array(97),.1)],Array.from({length:97},(_,i)=>i));
 assert.equal(F.quadraticMinima(Float64Array.of(0,1,0),1)[1],0);
});

test('temple and upper-cheek masks cannot pull controls onto ear extensions',()=>{
 const baseline=F.fitLandmarks(template,reference,reference,800,1000).landmarks,face=mask(240,300,(x,y)=>x>.08&&x<.92&&y>.2&&y<.9),masks={face};
 const native=new Map(baseline.map(p=>[p.id,p])),span=(reference[263].x-reference[33].x)*800;
 for(const input of [baseline,baseline.map(p=>F.reviewFaceContour(p,reference,800,1000,masks))]){
  const output=F.reviewVisibleContour(input,reference,800,1000,masks);
  for(const id of ['p18','p19','p28','p29']){const p=output.find(p=>p.id===id),seed=native.get(id),side=id==='p18'||id==='p28'?-1:1;assert(side*(p.x-seed.x)*800<=Math.max(span*.012,800/face.width*.75)+.1,id);}
 }
 for(const id of ['p18','p19','p28','p29']){const p=native.get(id),reviewed=F.reviewFaceContour(p,reference,800,1000,masks);assert.equal(reviewed.x,p.x);assert.equal(reviewed.y,p.y);}
});

test('head boundaries use mask resolution and reject cropped silhouettes',()=>{
 for(const resolution of [80,240,800]){
  const fitted=F.headBoundary(mask(resolution,resolution,(_,y)=>y>.16),[.5,.6],[.5,-.3]);
  assert.equal(fitted.reason,undefined);assert(Math.abs(fitted.point[1]-.16)<1.5/resolution);
 }
 const point=[.5,.05];assert.deepEqual(F.headBoundary(mask(100,100,()=>true),[.5,.6],point).point,point);
});

test('front opening follows supported hair or headwear, and keeps weak estimates',()=>{
 const current=reference.map(p=>({...p}));current[1]={x:.5,y:.6};current[33]={x:.3,y:.45};current[263]={x:.7,y:.45};
 const face=mask(200,250,(_,y)=>y>.25),cover=mask(200,250,(_,y)=>y<.25),seed=[.5,.2];
 for(const key of ['hair','clothing','accessories']){const fitted=F.reviewFrontOpening(seed,current,800,1000,{face,[key]:cover});assert(fitted.supported);assert(Math.abs(fitted.point[1]-.25)<.005);}
 assert.deepEqual(F.reviewFrontOpening(seed,current,800,1000,{face}).point,seed);
});

test('cached fitting uses the stored silhouette and preserves authored, locked and pinned controls',async()=>{
 const catalog=JSON.parse(await fs.readFile('public/library/catalog.json','utf8')),entry=catalog.entries.find(e=>e.id==='phenotypes-faces-annamidf.jpg'),source=JSON.parse(await fs.readFile('public/'+entry.preparation,'utf8'));
 const image=await loadImage('public/'+entry.mask),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 source.subjectMask={width:canvas.width,height:canvas.height,data:Uint8Array.from({length:canvas.width*canvas.height},(_,i)=>rgba[i*4])};source.landmarks[0].authored=true;source.landmarks[1].locked=true;
 const before=structuredClone(source),fitted=F.fitUnreviewed(source,template,{p28:[.2,.5]}),current=calibration.map((_,i)=>({x:source.featurePoints['mp-'+i][0],y:source.featurePoints['mp-'+i][1]})),expected=F.fitLandmarks(template,current,reference,source.width,source.height,source.subjectMask);
 assert.equal(fitted.fitVersion,F.FIT_VERSION);assert.deepEqual(source,before);
 for(const id of ['p01','p02','p28'])assert.deepEqual(fitted.landmarks.find(p=>p.id===id),source.landmarks.find(p=>p.id===id));
 for(const id of ['p47','p48','p49'])assert.deepEqual(fitted.landmarks.find(p=>p.id===id),expected.landmarks.find(p=>p.id===id));
 const p={sources:[{...fitted,regionWeights:F.regionDefaults()}],template,recipe:{...F.defaultRecipe(),earControls:false,hairControls:true},revision:0};
 const mesh=await F.buildMesh({...p,size:1024,quality:'final'},()=>false);assert(!mesh.controls.diagnostics.some(d=>d.kind==='error'||d.code==='folded-cells'));
});

test('saved current projects receive the correction once, with a recovery copy',async()=>{
 const catalog=JSON.parse(await fs.readFile('public/library/catalog.json','utf8')),entry=catalog.entries.find(e=>e.id==='phenotypes-faces-annamidf.jpg'),source=JSON.parse(await fs.readFile('public/'+entry.preparation,'utf8'));
 source.fitVersion=8;source.landmarks[0].authored=true;source.landmarks[1].locked=true;
 const project={schemaVersion:1,id:'cached',revision:0,name:'Cached',template,recipe:{...F.defaultRecipe(),pins:{p28:[.2,.5]}},sources:[source],variants:[]},before=structuredClone(project),updated=F.refreshAutomaticFit(project);
 assert.equal(updated.sources[0].fitVersion,F.FIT_VERSION);assert.equal(updated.variants.length,1);assert.equal(updated.variants[0].kind,'recovery');assert.deepEqual(updated.variants[0].sources,before.sources);assert.deepEqual(project,before);
 for(const id of ['p01','p02','p28'])assert.deepEqual(updated.sources[0].landmarks.find(p=>p.id===id),source.landmarks.find(p=>p.id===id));
 assert.equal(F.refreshAutomaticFit(updated),updated);
 const custom={...project,template:{...template,id:'custom'}};assert.equal(F.refreshAutomaticFit(custom),custom);
 const manual={...project,sources:[{...source,landmarks:source.landmarks.map(p=>({...p,authored:true}))}]};assert.equal(F.refreshAutomaticFit(manual),manual);
});

test('accepts supported public head silhouettes without folding the three-photo mix',async()=>{
 const catalog=JSON.parse(await fs.readFile('public/library/catalog.json','utf8')),sources=[];
 for(const name of ['Annamid F','Ainuid F','Nordid F']){
  const entry=catalog.entries.find(e=>e.name===name),source=JSON.parse(await fs.readFile('public/'+entry.preparation,'utf8')),image=await loadImage('public/'+entry.mask),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const mask={width:canvas.width,height:canvas.height,data:Uint8Array.from({length:canvas.width*canvas.height},(_,i)=>rgba[i*4])},current=calibration.map((_,i)=>({x:source.featurePoints['mp-'+i][0],y:source.featurePoints['mp-'+i][1]})),baseline=F.fitLandmarks(template,current,reference,source.width,source.height),fitted=F.fitLandmarks(template,current,reference,source.width,source.height,mask);
  assert(!fitted.note?.includes('Head boundary conflicts'),name);
  assert(fitted.landmarks.some(p=>/^p(47|48|49|50|51|52|53|54)$/.test(p.id)&&Math.hypot(p.x-baseline.landmarks.find(q=>q.id===p.id).x,p.y-baseline.landmarks.find(q=>q.id===p.id).y)>.001),name);
  sources.push({...source,id:name,landmarks:fitted.landmarks,regionWeights:F.regionDefaults()});
 }
 const mesh=await F.buildMesh({sources,template,recipe:{...F.defaultRecipe(),hairControls:true,earControls:false},size:1024,quality:'final',revision:0},()=>false);assert(!mesh.controls.diagnostics.some(d=>d.kind==='error'||d.code==='folded-cells'));
});

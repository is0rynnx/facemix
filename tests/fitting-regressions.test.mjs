import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {loadImage,createCanvas} from '@napi-rs/canvas';

const compiled=await build({stdin:{contents:"export * from './src/engine/fitting';export * from './src/engine/eye-geometry';export * from './src/engine/face-edits';export * from './src/engine/ear-evidence';export * from './src/engine/regions';export * from './src/engine/region-evidence';export * from './src/landmark-policy';export * from './src/engine/contour-evidence';export * from './src/engine/visible-contour';export * from './src/engine/head-evidence';export * from './src/engine/quadratic-minima';export * from './src/features';export * from './src/measured-detail';export * from './src/engine/mask-feather';export * from './src/mask-selection';export * from './src/engine/math';export * from './src/types';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
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

test('recovers a nearby headwear opening and permits the far-side silhouette under yaw',()=>{
 const current=reference.map(p=>({...p}));for(const [id,x,y]of [[33,.3,.4],[263,.7,.4],[234,.2,.5],[454,.72,.5],[127,.2,.4],[356,.72,.4],[1,.66,.58]])current[id]={x,y};
 const face=mask(400,500,(x,y)=>x>.24&&x<.78&&y>.15&&y<.85),hair=mask(400,500,x=>x<.24),seed=(id,x,y)=>({id,x,y,enabled:true,authored:false,locked:false,confidence:.6});
 const near=F.reviewFaceContour(seed('p18',.2,.4),current,800,1000,{face,hair}),far=F.reviewFaceContour(seed('p19',.72,.4),current,800,1000,{face,hair});
 assert(near.enabled);assert(Math.abs(near.x-.24)<.004);assert(far.enabled);assert(Math.abs(far.x-.78)<.004);
 const hand=F.reviewFaceContour(seed('p18',.2,.4),current,800,1000,{face,body:hair});assert.equal(hand.enabled,false);assert.equal(hand.autoDisabled,true);
 const authored={...seed('p18',.2,.4),authored:true};assert.equal(F.reviewFaceContour(authored,current,800,1000,{face,hair}),authored);
 const mirrored=current.map(p=>({x:1-p.x,y:p.y}));[mirrored[33],mirrored[263]]=[mirrored[263],mirrored[33]];[mirrored[234],mirrored[454]]=[mirrored[454],mirrored[234]];
 assert(F.farSideContour('p18',mirrored,800,1000));assert(!F.farSideContour('p19',mirrored,800,1000));
});

test('eyelid flanks sample observed curves and preserve edits, pins and saved variants',async()=>{
 const source=JSON.parse(await fs.readFile('public/library/prepared/phenotypes-faces-annamidf.jpg.json','utf8'));source.status='ready';source.id='native';
 const project={id:'detail',revision:0,sources:[source],template,recipe:F.defaultRecipe(),variants:[]},updated=F.withMeasuredDetail(project),ids=['lid-160','lid-158','lid-385','lid-387'];
 for(const id of ids){const def=updated.template.points.find(d=>d.id===id),p=updated.sources[0].landmarks.find(p=>p.id===id);assert(p.enabled,id);assert.deepEqual([p.x,p.y],F.eyePoint(def.id,calibration.map((_,i)=>({x:source.featurePoints['mp-'+i][0],y:source.featurePoints['mp-'+i][1]})),source.width/source.height));}
 assert.deepEqual(updated.template.contours.find(c=>c.name==='Left eyelid').ids,['p04','lid-160','lid-159','lid-158','p01','lid-153','lid-145','lid-144']);
 assert.deepEqual(updated.template.contours.find(c=>c.name==='Right eyelid').ids,['p02','lid-385','lid-386','lid-387','p03','lid-373','lid-374','lid-380']);
 assert.equal(F.withMeasuredDetail(updated),updated);
 const edited=structuredClone(updated);edited.sources[0].landmarks.find(p=>p.id===ids[0]).authored=true;edited.sources[0].landmarks.find(p=>p.id===ids[1]).locked=true;edited.sources[0].landmarks.find(p=>p.id===ids[2]).enabled=false;edited.recipe.pins[ids[3]]=[.4,.4];
 edited.sources[0].featurePoints['mp-160']=[.1,.1];edited.variants=[{id:'saved',name:'Saved',sources:structuredClone(edited.sources),recipe:edited.recipe,created:0}];const before=structuredClone(edited),again=F.withMeasuredDetail(edited);
 for(const id of ids)assert.deepEqual(again.sources[0].landmarks.find(p=>p.id===id),before.sources[0].landmarks.find(p=>p.id===id));assert.deepEqual(again.variants,before.variants);
});

test('selection feather is smooth, reversible and leaves stored paint unchanged',()=>{
 const selection=mask(32,32,x=>x>.5),original=structuredClone(selection),soft=F.featherMask(selection,3);
 assert.deepEqual(selection,original);assert.equal(F.featherMask(selection,0),selection);assert.equal(F.featherMask(selection,3),soft);
 const row=Array.from(soft.data.slice(16*32,17*32));assert.equal(row[0],0);assert.equal(row[31],255);assert(row.filter(v=>v>0&&v<255).length>=6);assert(row.every((v,i)=>i===0||v>=row[i-1]));
 for(const value of [0,255])assert(F.featherMask({width:24,height:12,data:new Uint8Array(288).fill(value)},6).data.every(v=>v===value));
 const probability={width:4,height:1,data:Uint8Array.of(0,51,153,255)},hair=F.excludeSelection(probability,undefined,4,1,'hair'),accessories=F.excludeSelection(probability,undefined,4,1,'accessories');assert(hair.data[1]<accessories.data[1]);assert.equal(hair.data[0],255);assert.equal(hair.data[3],0);
 assert.deepEqual(F.excludeSelection(probability,hair,4,1,'hair'),hair);
 const fringe={width:5,height:1,data:Uint8Array.of(0,5,40,128,255)},empty={width:5,height:1,data:new Uint8Array(5)},classes={hair:fringe,face:empty,body:empty,clothing:empty,accessories:empty};
 const removed=F.excludeSelection(fringe,undefined,5,1,'hair',classes);assert.deepEqual([...removed.data],[255,0,0,0,0]);
 const skin={...empty,data:new Uint8Array(5).fill(255)};assert(F.excludeSelection(empty,undefined,5,1,'hair',{...classes,hair:empty,face:skin}).data.every(v=>v===255));
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


test('curve spacing is metric-correct and independent of native vertex density',()=>{
 const path=[[.1,.2],[.2,.2],[.7,.2],[.7,.6]],aspect=2;
 for(const t of [.25,.5,.75]){const p=F.arcPoint(path,t,aspect),distance=t*1.6;assert(Math.abs((p[0]-.1)*2+(p[1]-.2)-distance)<1e-10);}
 assert.equal(F.arcPoint([[0,0],[0,0]],.5,1),undefined);
 const raw=reference.map(p=>({...p}));for(const [id,index]of Object.entries(F.irisVertices))assert.deepEqual(F.eyePoint(id,raw,.8),calibration[index]);
 for(const contour of F.eyelidContours){assert.equal(contour.ids.length,8);assert.equal(new Set(contour.ids).size,8);}
});

test('ear fitting requires a visible skin protrusion and preserves manual controls',()=>{
 const raw=reference.map(p=>({...p}));for(const [i,x,y]of [[33,.3,.3],[263,.7,.3],[234,.24,.4],[454,.76,.4],[1,.5,.5]])raw[i]={x,y};
 const defs=[['p18',.24,.3],['p28',.24,.4],['p21',.3,.55],['p19',.76,.3],['p29',.76,.4],['p20',.7,.55],['p45',.18,.4],['p44',.2,.5],['p42',.82,.4],['p43',.8,.5]],points=defs.map(([id,x,y])=>({id,x,y,enabled:true,authored:false,locked:false,confidence:.4}));
 const skin=mask(400,500,(x,y)=>x>.24+Math.max(0,y-.4)*.4&&x<.76-Math.max(0,y-.4)*.4&&y>.2&&y<.65||((x-.205)/.055)**2+((y-.41)/.09)**2<1);
 const found=F.reviewEarEvidence(points,raw,800,1000,{face:skin});assert(found.find(p=>p.id==='p45').enabled);assert(found.find(p=>p.id==='p45').x<.21);assert(found.find(p=>p.id==='p44').y>.44);assert(!found.find(p=>p.id==='p42').enabled);
 const manual=points.map(p=>p.id==='p45'?{...p,authored:true}:p),covered=F.reviewEarEvidence(manual,raw,800,1000,{face:mask(400,500,()=>false),hair:mask(400,500,()=>true)});assert.deepEqual(covered.find(p=>p.id==='p45'),manual.find(p=>p.id==='p45'));assert(!covered.find(p=>p.id==='p44').enabled);
 raw[1].x=.72;assert(!F.reviewEarEvidence(points,raw,800,1000,{face:skin}).find(p=>p.id==='p42').enabled);
});

test('semantic regions follow warped class masks and invalidate cached fields',()=>{
 const make=()=>({id:'semantic',name:'Photo',enabled:true,width:800,height:1000,shapeWeight:1,appearanceWeight:1,regionWeights:F.regionDefaults(),landmarks:[],analysisMasks:Object.fromEntries(['face','hair','body','clothing','accessories'].map(k=>[k,mask(32,40,()=>false)]))});
 const source=make(),q=[[0,0],[.8,0],[.8,1],[0,1]],uv=[[[0,0],[1,0],[1,1],[0,1]]],controls={q,uv,ids:['a','b','c','d'],sources:[source],diagnostics:[]},spec={sources:[source],template,recipe:{...F.defaultRecipe(),earControls:false},size:256,quality:'preview',revision:0};
 source.analysisMasks.hair=mask(32,40,(x,y)=>x<.3&&y>.65);source.analysisMasks.clothing=mask(32,40,(x,y)=>x>.7&&y<.3);source.analysisMasks.body=mask(32,40,(x,y)=>x>.45&&x<.55&&y>.7&&y<.79);
 const first=F.regionEvidence(spec,controls);assert.equal(F.regionEvidence(spec,controls),first);const partition=F.regionPartition(spec,controls),hair=partition([.15,.8]),clothing=partition([.85,.15]),neck=partition([.5,.77]);
 assert(hair[5]>.9);assert(clothing[8]>.9);assert(neck[7]>.5);for(const p of [hair,clothing,neck])assert(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-9);
 source.analysisMasks.hair=mask(32,40,()=>false);const next=F.regionEvidence(spec,controls);assert.notEqual(next,first);assert(next[1].data.every(v=>v===0));
 const shifted={...controls,uv:[uv[0].map(([x,y])=>[x+.2,y])]};source.analysisMasks.hair=mask(32,40,x=>x>.45&&x<.55);assert(F.sampleMask(F.regionEvidence(spec,shifted)[1],.3,.5)>.95);assert(F.sampleMask(F.regionEvidence(spec,shifted)[1],.5,.5)<.1);
});

test('region shape controls require matching enabled landmarks',()=>{
 const source={id:'s',enabled:true,landmarks:[{id:'ear',enabled:true},{id:'neck',enabled:false}]},project={sources:[source],template:{points:[{id:'ear',region:'ears'},{id:'neck',region:'neck'}]},recipe:{earControls:false}};
 assert(!F.regionHasShapeControls(project,'ears'));assert(!F.regionHasShapeControls(project,'neck'));assert(!F.regionHasShapeControls(project,'clothing'));project.recipe.earControls=true;assert(F.regionHasShapeControls(project,'ears'));
});


test('missing curves, closed eyes and cleared layouts do not invent eye controls',async()=>{
 const source=JSON.parse(await fs.readFile('public/library/prepared/phenotypes-faces-annamidf.jpg.json','utf8'));source.status='ready';source.id='missing';
 const p={id:'missing',revision:0,sources:[source],template,recipe:F.defaultRecipe(),variants:[]};
 delete source.featurePoints['mp-246'];const missing=F.withMeasuredDetail(p);assert(!missing.template.points.some(d=>d.id==='lid-160'));assert(missing.template.points.some(d=>d.id==='lid-385'));
 const closed=structuredClone(p);for(const n of F.eyePaths.rightLower)closed.sources[0].featurePoints['mp-'+n]=[...closed.sources[0].featurePoints['mp-386']];
 assert(!F.withMeasuredDetail(closed).template.points.some(d=>d.id==='lid-386'));
 const cleared={...p,template:{...template,points:[],contours:[]},sources:[{...source,landmarks:[]}]};assert.equal(F.withMeasuredDetail(cleared),cleared);
});

test('iris edges follow eye size and position but not eyelid-only height',()=>{
 const ids=['p04','p01','p02','p03','iris-472','iris-477'],points=[[.2,.4],[.35,.4],[.45,.4],[.6,.4],[.28,.42],[.52,.42]],recipe=F.defaultRecipe();
 assert.deepEqual(F.editFaceShape(ids,points,{...recipe,faceEdits:{eyeHeight:80}}),points);
 const changed=F.editFaceShape(ids,points,{...recipe,faceEdits:{eyeSize:80,eyeVertical:60}});for(const i of [4,5]){assert.notDeepEqual(changed[i],points[i]);assert(changed[i][1]<points[i][1]);}
});

test('manual region masks override class masks and incomplete geometry keeps registration',()=>{
 const source={id:'flat',enabled:true,width:800,height:1000,shapeWeight:1,appearanceWeight:1,regionWeights:F.regionDefaults(),landmarks:[],analysisMasks:Object.fromEntries(['face','hair','body','clothing','accessories'].map(k=>[k,mask(32,40,(x,y)=>k==='hair'&&x<.3&&y>.65)]))},spec={sources:[source],template,recipe:{...F.defaultRecipe(),regionFeather:0},size:256,quality:'preview',revision:0};
 const empty={q:[],uv:[[]],ids:[],sources:[source],diagnostics:[]},flat={...empty,q:[[.1,.4],[.3,.4],[.5,.4]],uv:[[[.1,.4],[.3,.4],[.5,.4]]],ids:['a','b','c']};
 assert.deepEqual(F.regionEvidence(spec,flat),F.regionEvidence(spec,empty));
 const painted={...spec,recipe:{...spec.recipe,regionMasks:{clothing:mask(32,40,()=>true)}}},partition=F.regionPartition(painted,flat);
 for(const p of [[.15,.8],[.5,.4]]){const weights=partition(p);assert.equal(weights[8],1);assert.equal(weights[5],0);}
});


test('warped class-mask sampling preserves bilinear values and crop boundaries',()=>{
 let seed=7;const noise=(w,h)=>({width:w,height:h,data:Uint8Array.from({length:w*h},()=>{seed=Math.imul(seed,1664525)+1013904223>>>0;return seed%256;})});
 const kinds=['face','hair','body','clothing','accessories'],source={id:'parity',width:800,height:1000,shapeWeight:1,analysisMasks:Object.fromEntries(kinds.map(k=>[k,noise(17,21)]))},controls={ids:['a','b','c','d'],q:[[0,0],[.8,0],[.8,1],[0,1]],uv:[[[0,0],[1,0],[1,1],[0,1]]],sources:[source],diagnostics:[]},spec={template,recipe:F.defaultRecipe()};
 for(const warp of ['triangles','mls']){const masks=F.regionEvidence({...spec,recipe:{...spec.recipe,warp}},controls);for(let y=0;y<240;y+=7)for(let x=0;x<192;x+=7)for(let k=0;k<5;k++){const expected=F.sampleMask(source.analysisMasks[kinds[k]],(x+.5)/192,(y+.5)/240)*255;assert(Math.abs(masks[k].data[y*192+x]-expected)<=.501);}}
 const outside={...controls,uv:[controls.uv[0].map(([x,y])=>[x+2,y])]};assert(F.regionEvidence(spec,outside).every(m=>m.data.every(v=>v===0)));
 const before=F.regionEvidenceKey(spec,controls);source.analysisMasks.face.data[0]^=255;assert.notEqual(F.regionEvidenceKey(spec,controls),before);
});

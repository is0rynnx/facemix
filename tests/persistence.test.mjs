import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {build} from 'esbuild';

test('commits and restores project data, variants, and editor state',async()=>{
 const result=await build({stdin:{contents:"export * from './src/data.ts';export * from './src/types.ts';export * from './src/session.ts';export * from './src/variants.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env.BASE_URL':JSON.stringify('./')}}),F=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const source={id:'photo',name:'Photo',width:20,height:30,enabled:true,shapeWeight:100,appearanceWeight:100,weightLocked:false,status:'ready',regionWeights:F.regionDefaults(),landmarks:[{id:'p01',x:.2,y:.3,enabled:true,locked:false,authored:true,confidence:1}],subjectMask:{width:2,height:1,data:new Uint8Array([25,240])}};
 const project={schemaVersion:1,id:'session',name:'Saved project',revision:1,template:{id:'custom',version:1,name:'Controls',points:[],contours:[]},recipe:F.defaultRecipe(),sources:[source],variants:[]},editor={projectId:'session',workspace:'landmarks',inspector:'shape',selectedSource:'photo',selectedPoints:['p01'],zoom:1.5,pan:[.1,-.1],showLabels:true,showLines:true,pointRegion:'all',tool:'move',brush:.04,maskTarget:'subject',wipe:50,isolatedSource:'',inspectSource:'',compareVariant:''};
 F.registerAsset('photo',new Blob(['pixels']));await F.autosave(project,editor);F.assets.clear();assert.deepEqual((await F.restore()).sources,project.sources);assert.deepEqual(await F.restoreEditor(),editor);assert.equal(await (await F.ensureAsset('photo')).blob.text(),'pixels');
 const variant={id:'variant',kind:'saved',name:'Variant 1',created:1,sources:structuredClone(project.sources),recipe:structuredClone(project.recipe),template:project.template},updated={...project,variants:[variant]},statuses=[];
 const queue=F.createSaveQueue(snapshot=>F.autosave(snapshot.project,snapshot.editor),status=>statuses.push(status));queue.schedule({project:updated,editor});const commit=queue.flush();assert.deepEqual((await F.restore()).variants,[variant]);assert.equal(await commit,true);assert.equal(statuses.at(-1),'saved');
 const backup=F.recoverySnapshot(updated,'detail-12'),withBackup={...updated,variants:[variant,backup]};assert.equal(F.savedVariants(withBackup.variants).length,1);assert.equal(F.recoverySnapshot(withBackup,'detail-12'),undefined);assert.equal(F.nextVariantName(withBackup.variants),'Variant 2');
 F.registerAsset('pending',new Blob(['pending pixels']));const oldWrite=F.autosave({...project,name:'Older',sources:[{...source,id:'pending'}]});await F.autosave({...updated,name:'Latest'});await oldWrite;assert.equal((await F.restore()).name,'Latest');
});

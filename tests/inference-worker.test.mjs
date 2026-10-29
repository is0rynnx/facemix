import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const code=await readFile(new URL('../public/workers/inference.worker.js',import.meta.url),'utf8');
function harness({maskSetupFails=false,fitFails=false,maskReadFails=false}={}){
 const bitmaps=[],results=[],messages=[],facePoints=[{x:.2,y:.2},{x:.8,y:.8}];
 const fitted={landmarks:[{id:'point',x:.5,y:.5}],observation:{}};
 const scope={console,OffscreenCanvas:class{},createImageBitmap:async(_,size)=>{const bitmap={width:size?.resizeWidth??2000,height:size?.resizeHeight??2000,closed:0,close(){this.closed++;}};bitmaps.push(bitmap);return bitmap;},
 FaceMixFitting:{CALIBRATION_VERSION:1,FIT_VERSION:1,fitLandmarks(){if(fitFails)throw Error('Fit failed');return fitted;}},
 importScripts(){scope.exports={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async()=>({detect:()=>({faceLandmarks:[facePoints]})})},ImageSegmenter:{createFromOptions:async()=>{if(maskSetupFails)throw Error('Mask model unavailable');return {segment(){const result={closed:0,close(){this.closed++;},categoryMask:{width:1,height:1,getAsUint8Array(){if(maskReadFails)throw Error('Mask read failed');return new Uint8Array([3]);}}};results.push(result);return result;}};}}};},
 postMessage(message){messages.push(message);}};
 scope.self=scope;const context=vm.createContext(scope);vm.runInContext(code,context);
 const send=async data=>{scope.onmessage({data});await vm.runInContext('busy',context);};
 return {bitmaps,results,messages,send,init:()=>send({type:'init',base:'/',template:{points:[]},calibrationVersion:1,calibration:Array.from({length:478},()=>[.5,.5])})};
}
test('landmark detection works when the optional mask model cannot start',async()=>{
 const h=harness({maskSetupFails:true});await h.init();await h.send({type:'detect',job:'a',blob:{}});
 assert.equal(h.messages.at(-1).type,'detected');assert.equal(h.messages.at(-1).found,true);assert.match(h.messages.at(-1).note,/mask unavailable/);
 assert.equal(h.bitmaps.length,2);assert(h.bitmaps.every(b=>b.closed===1));
});
test('releases original and resized images after a fitting error, and settles each queued request',async()=>{
 const h=harness({fitFails:true});await h.init();await h.send({type:'detect',job:'a',blob:{}});await h.send({type:'detect',job:'b',blob:{}});
 assert.equal(h.messages.filter(m=>m.type==='error').length,2);assert(h.bitmaps.every(b=>b.closed===1));assert(h.results.every(r=>r.closed===1));
});
test('releases mask results even when mask data cannot be read',async()=>{
 const h=harness({maskReadFails:true});await h.init();await h.send({type:'detect',job:'a',blob:{}});
 assert.equal(h.messages.at(-1).type,'detected');assert.equal(h.results[0].closed,1);assert(h.bitmaps.every(b=>b.closed===1));
});

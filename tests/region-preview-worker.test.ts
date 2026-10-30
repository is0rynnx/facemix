import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {REGIONS} from '../src/types';
const mocks=vi.hoisted(()=>({controls:vi.fn(),partition:vi.fn(),post:vi.fn()}));
vi.mock('../src/engine/math',()=>({buildControls:mocks.controls}));
vi.mock('../src/engine/regions',()=>({regionPartition:mocks.partition}));
let scope:any;
beforeEach(async()=>{vi.resetModules();vi.clearAllMocks();scope={postMessage:mocks.post};vi.stubGlobal('self',scope);mocks.controls.mockReturnValue({});await import('../src/engine/region-preview.worker');});
afterEach(()=>vi.unstubAllGlobals());
it('reports readiness and preserves the region alpha field pixel for pixel',()=>{
 expect(mocks.post).toHaveBeenCalledWith({type:'ready'});
 mocks.partition.mockReturnValue(([x,y]:number[])=>REGIONS.map(r=>r==='hair'?x*y:0));
 scope.onmessage({data:{type:'preview',id:3,region:'hair',spec:{}}});
 const [response,transfers]=mocks.post.mock.calls.at(-1)!;expect(response).toMatchObject({type:'result',id:3,width:128,height:160});expect(transfers).toEqual([response.data.buffer]);
 for(let y=0;y<160;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;expect([...response.data.subarray(i,i+4)]).toEqual([20,115,230,Math.round((x+.5)/128*(y+.5)/160*170)]);}
});
it('reports computation errors and can handle the next request',()=>{
 mocks.partition.mockImplementationOnce(()=>{throw Error('Bad geometry');}).mockReturnValue(()=>REGIONS.map(()=>0));
 scope.onmessage({data:{type:'preview',id:1,region:'neck',spec:{}}});expect(mocks.post).toHaveBeenLastCalledWith({type:'error',id:1,error:'Error: Bad geometry'});
 scope.onmessage({data:{type:'preview',id:2,region:'neck',spec:{}}});expect(mocks.post.mock.calls.at(-1)![0]).toMatchObject({type:'result',id:2});
});

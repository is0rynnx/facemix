import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({buildMesh:vi.fn(),gpu:vi.fn(),render:vi.fn(),dispose:vi.fn(),cpu:vi.fn(),post:vi.fn()}));
vi.mock('../src/engine/math',()=>({buildMesh:mocks.buildMesh,geometrySignature:()=>'',regionalInfluence:()=>[1]}));
vi.mock('../src/engine/gpu',()=>({GPUCompositor:class{constructor(){mocks.gpu();}render=mocks.render;dispose=mocks.dispose;}}));
vi.mock('../src/engine/cpu-renderer',()=>({renderCPU:mocks.cpu}));
let scope:any;
const request=(job:number)=>({data:{type:'render',job,spec:{revision:job,sources:[{id:'a',enabled:true}],recipe:{warp:'triangles'},size:2048,quality:'final'}}});
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();scope={postMessage:mocks.post};vi.stubGlobal('self',scope);
 mocks.buildMesh.mockResolvedValue({vertices:[1,2,3],uvs:[],controls:{diagnostics:[]}});
 mocks.cpu.mockResolvedValue({width:1638,height:2048,blob:new Blob(['pixels']),backend:'CPU'});
 mocks.render.mockRejectedValue(new Error('GPU context lost'));
 await import('../src/workers/render.worker');
});
afterEach(()=>{vi.unstubAllGlobals();});
async function complete(job:number){scope.onmessage(request(job));await vi.waitFor(()=>expect(mocks.post.mock.calls.some(([m])=>m.type==='result'&&m.job===job)).toBe(true));}
it('signals readiness and keeps CPU fallback after a GPU failure',async()=>{
 expect(mocks.post).toHaveBeenCalledWith({type:'ready'});
 await complete(1);await complete(2);
 expect(mocks.gpu).toHaveBeenCalledOnce();expect(mocks.render).toHaveBeenCalledOnce();expect(mocks.dispose).toHaveBeenCalledOnce();expect(mocks.cpu).toHaveBeenCalledTimes(2);
 expect(mocks.cpu.mock.calls[1][0]).toMatchObject({size:2048,quality:'final'});
});
it('can start directly on CPU without allocating a GPU context',async()=>{
 scope.onmessage({data:{type:'configure',forceCPU:true}});await complete(1);
 expect(mocks.gpu).not.toHaveBeenCalled();expect(mocks.cpu).toHaveBeenCalledOnce();
});

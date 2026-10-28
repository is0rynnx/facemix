import { normalize, regionsGeometry, type WarpMesh } from './math';

import { REGIONS, type Mask, type RenderSpec, type Source } from '../types';

import {regionalWeightMaps,type WeightMap} from './regions';
import {featherMask} from './mask-feather';

export interface ImageAsset { blob:Blob; bitmap?:ImageBitmap; original?:ImageBitmap; mask?:Mask; exclusion?:Mask; colorStats?:{key:string;values:number[]}; }

const vertex=`#version 300 es

in vec2 a_position;in vec2 a_uv;out vec2 v_uv;

void main(){gl_Position=vec4(a_position.x*2.-1.,1.-a_position.y*2.,0.,1.);v_uv=a_uv;}`;

const quadVertex=`#version 300 es

out vec2 v_uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);v_uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;

const warpFragment=`#version 300 es

precision highp float;in vec2 v_uv;layout(location=0)out vec4 frag;layout(location=1)out vec4 availability;

uniform sampler2D u_image,u_mask,u_exclude;uniform bool u_remove,u_linear,u_cubic,u_hasMask,u_hasExclude;

uniform vec2 u_imageSize,u_maskSize,u_sourceSize;uniform float u_feather,u_decontam,u_cropFeather;uniform vec3 u_gain;

vec3 linearize(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}

float kernel(float x){x=abs(x);return x<1.?1.5*x*x*x-2.5*x*x+1.:x<2.?-.5*x*x*x+2.5*x*x-4.*x+2.:0.;}

vec4 sampleImage(vec2 uv){if(!u_cubic)return texture(u_image,uv);vec2 p=uv*u_imageSize-.5,b=floor(p),f=p-b;vec4 c=vec4(0.);float w=0.;for(int j=-1;j<=2;j++)for(int i=-1;i<=2;i++){float k=kernel(float(i)-f.x)*kernel(float(j)-f.y);c+=texture(u_image,(b+vec2(i,j)+.5)/u_imageSize)*k;w+=k;}return clamp(c/w,0.,1.);}

void main(){if(any(lessThan(v_uv,vec2(0.)))||any(greaterThan(v_uv,vec2(1.)))){frag=vec4(0.);availability=vec4(0.);return;}

 vec4 c=sampleImage(v_uv);c.rgb=c.a>.00001?clamp(c.rgb/c.a,0.,1.):vec3(0.);float a=1.;

 if(u_remove&&u_hasMask){a=texture(u_mask,v_uv).r;if(u_feather>0.){float s=a*4.;for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){if(i!=0||j!=0)s+=texture(u_mask,v_uv+vec2(i,j)*u_feather/u_maskSize).r;}a=s/12.;}}

 float subjectAlpha=a;float cover=1.;if(u_cropFeather>0.){vec2 d=min(v_uv,1.-v_uv)*u_sourceSize;cover=smoothstep(0.,u_cropFeather,min(d.x,d.y)/max(u_sourceSize.x,u_sourceSize.y));}

 if(u_hasExclude)cover*=texture(u_exclude,v_uv).r;availability=vec4(cover,0.,0.,0.);a*=cover;

 if(u_remove&&u_hasMask&&u_decontam>0.&&subjectAlpha>.03&&subjectAlpha<.97){vec3 fg=vec3(0.);float w=0.;for(int r=0;r<3;r++){float radius=r==0?2.:r==1?4.:8.;for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){if(i==0&&j==0)continue;vec2 p=v_uv+vec2(i,j)*radius/u_maskSize;if(any(lessThan(p,vec2(0.)))||any(greaterThan(p,vec2(1.))))continue;vec4 neighbor=sampleImage(p);float m=max(0.,texture(u_mask,p).r-subjectAlpha),k=m*m*neighbor.a;fg+=neighbor.rgb/max(neighbor.a,.00001)*k;w+=k;}}if(w>0.)c.rgb=mix(c.rgb,fg/w,u_decontam*(1.-subjectAlpha));}

 c.rgb=clamp(c.rgb*u_gain,0.,1.);if(u_linear)c.rgb=linearize(c.rgb);frag=vec4(c.rgb,a*c.a);

}`;

const accumulateFragment=`#version 300 es

precision highp float;in vec2 v_uv;layout(location=0)out vec4 frag;layout(location=1)out vec4 availability;uniform sampler2D u_previous,u_warped,u_previousCoverage,u_warpedCoverage,u_weightMap;uniform vec4 u_tile;

float weightAt(vec2 p){ivec2 size=textureSize(u_weightMap,0);vec2 v=p*vec2(size)-.5;ivec2 b=ivec2(floor(v));vec2 f=fract(v);return mix(mix(texelFetch(u_weightMap,clamp(b,ivec2(0),size-1),0).r,texelFetch(u_weightMap,clamp(b+ivec2(1,0),ivec2(0),size-1),0).r,f.x),mix(texelFetch(u_weightMap,clamp(b+ivec2(0,1),ivec2(0),size-1),0).r,texelFetch(u_weightMap,clamp(b+ivec2(1,1),ivec2(0),size-1),0).r,f.x),f.y);}

void main(){vec2 p=vec2(v_uv.x,1.-v_uv.y)*u_tile.zw+u_tile.xy;float w=weightAt(p);

 vec4 c=texture(u_warped,v_uv);frag=texture(u_previous,v_uv)+vec4(c.rgb*c.a*w,c.a*w);float cover=texture(u_warpedCoverage,v_uv).r;vec4 prev=texture(u_previousCoverage,v_uv);availability=vec4(prev.r+cover*w,max(prev.g,w>0.?cover:0.),0.,0.);

}`;

const finalFragment=`#version 300 es

precision highp float;in vec2 v_uv;out vec4 frag;uniform sampler2D u_accum,u_background,u_coverage;uniform int u_bgMode;uniform vec3 u_bg;uniform bool u_linear,u_fillMissing;

vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));}

void main(){vec4 c=texture(u_accum,v_uv),coverage=texture(u_coverage,v_uv);vec3 rgb=c.a>.00001?c.rgb/c.a:vec3(0.);if(u_linear)rgb=encode(rgb);float alpha=clamp(u_fillMissing&&coverage.r>.00001?c.a/coverage.r*coverage.g:c.a,0.,1.);

 if(u_bgMode==1){rgb=mix(u_bg,rgb,alpha);alpha=1.;}else if(u_bgMode==2){vec4 bg=texture(u_background,v_uv);rgb=rgb*alpha+bg.rgb*(1.-alpha);alpha=alpha+bg.a*(1.-alpha);}frag=vec4(clamp(rgb,0.,1.),alpha);

}`;

export class GPUCompositor{

 canvas:OffscreenCanvas;gl:WebGL2RenderingContext;warp:WebGLProgram;accumulate:WebGLProgram;final:WebGLProgram;
 private previews=new Map<ImageAsset,{texture:WebGLTexture;bytes:number}>();
 releaseAsset(asset:ImageAsset){const cached=this.previews.get(asset);if(cached)this.gl.deleteTexture(cached.texture);this.previews.delete(asset);}
 private previewTexture(asset:ImageAsset,bitmap:ImageBitmap){let cached=this.previews.get(asset);if(cached){this.previews.delete(asset);this.previews.set(asset,cached);return cached.texture;}cached={texture:this.texture(bitmap),bytes:bitmap.width*bitmap.height*4};this.previews.set(asset,cached);while(this.previews.size>32||[...this.previews.values()].reduce((n,v)=>n+v.bytes,0)>128*1024*1024){const oldest=this.previews.keys().next().value!;this.releaseAsset(oldest);}return cached.texture;}

 constructor(){

  this.canvas=new OffscreenCanvas(16,16);const gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false});

  if(!gl)throw new Error('WebGL2 unavailable');this.gl=gl;if(!gl.getExtension('EXT_color_buffer_float'))throw new Error('Floating point render targets unavailable');

  this.warp=this.program(vertex,warpFragment);this.accumulate=this.program(quadVertex,accumulateFragment);this.final=this.program(quadVertex,finalFragment);

 }

 program(v:string,f:string){const g=this.gl;const shader=(type:number,source:string)=>{const s=g.createShader(type)!;g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s)??'Shader compilation failed');return s;};const p=g.createProgram()!,vs=shader(g.VERTEX_SHADER,v),fs=shader(g.FRAGMENT_SHADER,f);g.attachShader(p,vs);g.attachShader(p,fs);g.linkProgram(p);g.deleteShader(vs);g.deleteShader(fs);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p)??'GPU link failed');return p;}

 uniform(p:WebGLProgram,name:string){return this.gl.getUniformLocation(p,name);}

 target(w:number,h:number,coverage=false){const g=this.gl,t=g.createTexture()!,f=g.createFramebuffer()!;const allocate=(texture:WebGLTexture)=>{g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,w,h,0,g.RGBA,g.FLOAT,null);};allocate(t);g.bindFramebuffer(g.FRAMEBUFFER,f);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,t,0);let aux:WebGLTexture|undefined;if(coverage){aux=g.createTexture()!;allocate(aux);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT1,g.TEXTURE_2D,aux,0);g.drawBuffers([g.COLOR_ATTACHMENT0,g.COLOR_ATTACHMENT1]);}if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('GPU framebuffer incomplete');return {t,f,aux};}

 texture(bitmap:ImageBitmap|Mask|WeightMap|undefined){const g=this.gl,t=g.createTexture()!;g.bindTexture(g.TEXTURE_2D,t);g.pixelStorei(g.UNPACK_ALIGNMENT,1);const floating=bitmap&&'data' in bitmap&&bitmap.data instanceof Float32Array;g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,floating?g.NEAREST:g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,floating?g.NEAREST:g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);

  if(bitmap&&'data' in bitmap)g.texImage2D(g.TEXTURE_2D,0,floating?g.R32F:g.R8,bitmap.width,bitmap.height,0,g.RED,floating?g.FLOAT:g.UNSIGNED_BYTE,bitmap.data);

  else if(bitmap)g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,bitmap);

  else g.texImage2D(g.TEXTURE_2D,0,g.R8,1,1,0,g.RED,g.UNSIGNED_BYTE,new Uint8Array([255]));return t;}

 bind(p:WebGLProgram,name:string,t:WebGLTexture,unit:number){const g=this.gl;g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,t);g.uniform1i(this.uniform(p,name),unit);}

 async render(spec:RenderSpec,mesh:WarpMesh,assets:Map<string,ImageAsset>,cancelled:()=>boolean,tile?:{x:number;y:number;w:number;h:number}):Promise<{bitmap?:ImageBitmap;blob?:Blob;width:number;height:number;backend:string}>{

  const fullW=Math.round(spec.size*Math.min(1,spec.recipe.aspect)),fullH=Math.round(spec.size/Math.max(1,spec.recipe.aspect));

  if(!tile&&spec.quality==='final'&&Math.max(fullW,fullH)>1024){

   const output=new OffscreenCanvas(fullW,fullH),ctx=output.getContext('2d')!;

   for(let y=0;y<fullH;y+=1024)for(let x=0;x<fullW;x+=1024){if(cancelled())throw new Error('cancelled');const result=await this.render(spec,mesh,assets,cancelled,{x,y,w:Math.min(1024,fullW-x),h:Math.min(1024,fullH-y)});ctx.drawImage(result.bitmap!,x,y);result.bitmap!.close();}

   return {blob:await output.convertToBlob({type:'image/png'}),width:fullW,height:fullH,backend:'WebGL2 / tiled float32'};

  }

  const g=this.gl,w=tile?.w??fullW,h=tile?.h??fullH;

  if(g.isContextLost())throw new Error('GPU context lost; retrying will restore the compositor.');this.canvas.width=w;this.canvas.height=h;g.viewport(0,0,w,h);g.disable(g.BLEND);g.disable(g.DEPTH_TEST);

  const targets=[this.target(w,h,true),this.target(w,h,true)],warped=this.target(w,h,true),background=this.target(w,h),created:WebGLTexture[]=[],buffers:WebGLBuffer[]=[];

  const vao=g.createVertexArray()!;g.bindVertexArray(vao);let current=0;

  const weightMaps=regionalWeightMaps(spec,mesh.controls);

  const gains=spec.recipe.colorMatch?await colorGains(mesh.controls.sources,assets):mesh.controls.sources.map(()=>[1,1,1]);

  const total=mesh.controls.sources.reduce((s,v)=>s+Math.max(0,v.appearanceWeight),0);if(total<=0)throw new Error('All appearance influences are zero.');

  const pushBuffer=(target:number,data:BufferSource)=>{const b=g.createBuffer()!;buffers.push(b);g.bindBuffer(target,b);g.bufferData(target,data,g.STATIC_DRAW);return b;};

  const pos=pushBuffer(g.ARRAY_BUFFER,new Float32Array(mesh.vertices.flatMap(p=>[(p[0]/spec.recipe.aspect*fullW-(tile?.x??0))/w,(p[1]*fullH-(tile?.y??0))/h]))),indices=pushBuffer(g.ELEMENT_ARRAY_BUFFER,mesh.triangles);

  for(const target of targets){g.bindFramebuffer(g.FRAMEBUFFER,target.f);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);}

  g.bindFramebuffer(g.FRAMEBUFFER,background.f);g.clear(g.COLOR_BUFFER_BIT);

  try{

   for(let s=0;s<mesh.controls.sources.length;s++){

    if(cancelled())throw new Error('cancelled');const source=mesh.controls.sources[s],asset=assets.get(source.id);if(!asset)continue;

    const original=spec.quality==='final'||spec.size>1024,bitmap=await getBitmap(asset,source,original);const t=original?this.texture(bitmap):this.previewTexture(asset,bitmap),mask=this.texture(source.subjectMask??asset.mask),ex=this.texture(featherMask(source.exclusionMask??asset.exclusion,spec.recipe.contributionFeather??1.5)),weightMap=this.texture(weightMaps[s]);created.push(...(original?[t]:[]),mask,ex,weightMap);

    g.useProgram(this.warp);g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,pos);const pl=g.getAttribLocation(this.warp,'a_position');g.enableVertexAttribArray(pl);g.vertexAttribPointer(pl,2,g.FLOAT,false,0,0);

    const uv=pushBuffer(g.ARRAY_BUFFER,new Float32Array(mesh.uvs[s].flat()));const ul=g.getAttribLocation(this.warp,'a_uv');g.enableVertexAttribArray(ul);g.vertexAttribPointer(ul,2,g.FLOAT,false,0,0);g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,indices);

    this.bind(this.warp,'u_image',t,0);this.bind(this.warp,'u_mask',mask,1);this.bind(this.warp,'u_exclude',ex,2);

    const u=(n:string)=>this.uniform(this.warp,n);g.uniform1i(u('u_remove'),spec.recipe.removeBackground?1:0);g.uniform1i(u('u_hasMask'),source.subjectMask||asset.mask?1:0);g.uniform1i(u('u_hasExclude'),source.exclusionMask||asset.exclusion?1:0);g.uniform1i(u('u_linear'),spec.recipe.blend==='linear'?1:0);g.uniform1i(u('u_cubic'),spec.quality==='final'?1:0);g.uniform2f(u('u_imageSize'),bitmap.width,bitmap.height);const m=source.subjectMask??asset.mask;g.uniform2f(u('u_maskSize'),m?.width??1,m?.height??1);g.uniform1f(u('u_feather'),spec.recipe.feather);g.uniform1f(u('u_decontam'),spec.recipe.decontaminate);

    g.uniform3fv(u('u_gain'),gains[s]);

    g.uniform2f(u('u_sourceSize'),source.width,source.height);g.uniform1f(u('u_cropFeather'),spec.recipe.cropFeather??0);

    g.bindFramebuffer(g.FRAMEBUFFER,warped.f);g.clear(g.COLOR_BUFFER_BIT);g.drawElements(g.TRIANGLES,mesh.triangles.length,g.UNSIGNED_INT,0);

    if(spec.recipe.background==='source'&&source.id===(spec.recipe.backgroundSourceId??mesh.controls.sources[0].id)){

      g.uniform1i(u('u_remove'),0);g.uniform1i(u('u_hasExclude'),0);g.uniform1i(u('u_linear'),0);g.bindFramebuffer(g.FRAMEBUFFER,background.f);g.drawElements(g.TRIANGLES,mesh.triangles.length,g.UNSIGNED_INT,0);

    }

    g.useProgram(this.accumulate);g.bindVertexArray(null);g.bindFramebuffer(g.FRAMEBUFFER,targets[1-current].f);this.bind(this.accumulate,'u_previous',targets[current].t,0);this.bind(this.accumulate,'u_warped',warped.t,1);

    this.bind(this.accumulate,'u_previousCoverage',targets[current].aux!,2);this.bind(this.accumulate,'u_warpedCoverage',warped.aux!,3);this.bind(this.accumulate,'u_weightMap',weightMap,4);

    g.uniform4f(this.uniform(this.accumulate,'u_tile'),(tile?.x??0)/fullW,(tile?.y??0)/fullH,w/fullW,h/fullH);

    g.drawArrays(g.TRIANGLES,0,3);current=1-current;

    g.deleteBuffer(uv);buffers.splice(buffers.indexOf(uv),1);for(const tex of [...(original?[t]:[]),mask,ex,weightMap]){g.deleteTexture(tex);created.splice(created.indexOf(tex),1);}

    if((spec.quality==='final'||spec.size>1024)&&asset.original){asset.original.close();asset.original=undefined;}

    if(s%4===3||s===mesh.controls.sources.length-1)await new Promise(r=>setTimeout(r,0));

   }

   if(cancelled())throw new Error('cancelled');g.bindFramebuffer(g.FRAMEBUFFER,null);g.useProgram(this.final);g.bindVertexArray(null);this.bind(this.final,'u_accum',targets[current].t,0);this.bind(this.final,'u_background',background.t,1);this.bind(this.final,'u_coverage',targets[current].aux!,2);g.uniform1i(this.uniform(this.final,'u_fillMissing'),spec.recipe.fillMissing?1:0);

   g.uniform1i(this.uniform(this.final,'u_bgMode'),spec.recipe.background==='solid'?1:spec.recipe.background==='source'?2:0);const hex=spec.recipe.backgroundColor;g.uniform3f(this.uniform(this.final,'u_bg'),parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);g.uniform1i(this.uniform(this.final,'u_linear'),spec.recipe.blend==='linear'?1:0);g.drawArrays(g.TRIANGLES,0,3);

   const error=g.getError();if(error!==g.NO_ERROR)throw new Error(`GPU render error ${error}`);

   if(spec.quality==='final'&&!tile)return {blob:await this.canvas.convertToBlob({type:'image/png'}),width:w,height:h,backend:'WebGL2 / float32'};

   return {bitmap:this.canvas.transferToImageBitmap(),width:w,height:h,backend:'WebGL2 / float32'};

  }finally{for(const b of buffers)g.deleteBuffer(b);for(const t of created)g.deleteTexture(t);for(const target of [...targets,warped,background]){g.deleteFramebuffer(target.f);g.deleteTexture(target.t);if(target.aux)g.deleteTexture(target.aux);}g.deleteVertexArray(vao);}

 }

}

export async function getBitmap(asset:ImageAsset,source:Source,original:boolean){

 if(original){if(!asset.original)asset.original=await createImageBitmap(asset.blob,{premultiplyAlpha:'premultiply'});return asset.original;}

 if(!asset.bitmap){const scale=Math.min(1,1024/Math.max(source.width,source.height));asset.bitmap=await createImageBitmap(asset.blob,{resizeWidth:Math.max(1,Math.round(source.width*scale)),resizeHeight:Math.max(1,Math.round(source.height*scale)),resizeQuality:'high',premultiplyAlpha:'premultiply'});}return asset.bitmap;

}

async function sourceColorStats(asset:ImageAsset,source:Source):Promise<number[]>{
 const p=source.landmarks.find(p=>p.id==='p55')??{x:.5,y:.5},key=JSON.stringify([p.x,p.y]);
 if(asset.colorStats?.key===key)return asset.colorStats.values;
 const bitmap=await getBitmap(asset,source,false),c=new OffscreenCanvas(32,32),ctx=c.getContext('2d')!;ctx.drawImage(bitmap,(p.x-.1)*bitmap.width,(p.y-.04)*bitmap.height,bitmap.width*.2,bitmap.height*.16,0,0,32,32);const d=ctx.getImageData(0,0,32,32).data;const sums=[0,0,0];for(let i=0;i<d.length;i+=4)for(let k=0;k<3;k++)sums[k]+=d[i+k];const values=sums.map(v=>v/1024);asset.colorStats={key,values};return values;

}

export async function colorGains(sources:Source[],assets:Map<string,ImageAsset>):Promise<number[][]>{const stats=await Promise.all(sources.map(async s=>{const asset=assets.get(s.id);return asset?sourceColorStats(asset,s):[128,128,128];})),weights=normalize(sources.map(s=>s.appearanceWeight)),target=[0,1,2].map(k=>stats.reduce((sum,v,i)=>sum+v[k]*weights[i],0));return stats.map(v=>v.map((channel,k)=>Math.max(.67,Math.min(1.5,target[k]/Math.max(1,channel)))));}

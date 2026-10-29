/* Classic worker deliberately: MediaPipe's WASM loader uses importScripts. */

let face, segmenter, reference, template, initialized, busy=Promise.resolve();

self.onmessage=e=>{const m=e.data;busy=busy.then(async()=>{

 try{

  if(m.type==='init'){if(!initialized)initialized=initialize(m);await initialized;self.postMessage({type:'ready'});return;}

  if(m.type==='template'){template=m.template;return;}

  if(m.type==='detect'){await initialized;const result=await detect(m.blob);self.postMessage({type:'detected',job:m.job,...result},result.mask?[result.mask.data.buffer]:[]);}

 }catch(error){self.postMessage({type:'error',job:m.job,message:String(error)});}

});};

async function initialize(m){

 template=m.template;importScripts(m.base+'workers/fitting.js?v=1.6.1');self.exports={};importScripts(m.base+'models/vision_bundle.js');

 const {FilesetResolver,FaceLandmarker,ImageSegmenter}=self.exports;

 const wasm=await FilesetResolver.forVisionTasks(m.base+'models');

 face=await FaceLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:m.base+'models/face_landmarker.task',delegate:'CPU'},runningMode:'IMAGE',numFaces:30,canvas:new OffscreenCanvas(1,1)});

 try{segmenter=await ImageSegmenter.createFromOptions(wasm,{baseOptions:{modelAssetPath:m.base+'models/selfie_multiclass.tflite',delegate:'CPU'},runningMode:'IMAGE',outputCategoryMask:true,outputConfidenceMasks:true,canvas:new OffscreenCanvas(1,1)});}catch{segmenter=undefined;}

 if(m.calibrationVersion!==FaceMixFitting.CALIBRATION_VERSION||!Array.isArray(m.calibration)||m.calibration.length!==478)throw new Error('Face calibration version mismatch. Reload the app.');
 reference=m.calibration.map(p=>({x:p[0],y:p[1]}));

}

async function detect(blob){

 const bitmap=await createImageBitmap(blob);let image=bitmap;
 try{
 const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));

 if(scale<1)image=await createImageBitmap(bitmap,{resizeWidth:Math.round(bitmap.width*scale),resizeHeight:Math.round(bitmap.height*scale)});

 const faces=face.detect(image).faceLandmarks;let mask,headMask,analysisMasks,note;

 let result;try{result=segmenter.segment(image);const category=result.categoryMask;const categories=category.getAsUint8Array(),background=result.confidenceMasks?.[0];mask={width:category.width,height:category.height,data:background?Uint8Array.from(background.getAsFloat32Array(),v=>Math.round(255*Math.max(0,Math.min(1,1-v)))):Uint8Array.from(categories,v=>v===0?0:255)};headMask={width:category.width,height:category.height,data:Uint8Array.from(categories,v=>[1,3,5].includes(v)?255:0)};analysisMasks={};for(const [name,index] of [['face',3],['hair',1],['body',2],['clothing',4],['accessories',5]]){const values=result.confidenceMasks?.[index]?.getAsFloat32Array();analysisMasks[name]=compactMask(values??categories,category.width,category.height,values?undefined:index);}}catch(error){note='Automatic mask unavailable. Paint a subject mask manually.';}finally{result?.close();}

 let landmarks,featurePoints,observation,candidates;

 if(faces.length){

  candidates=faces.slice().sort((a,b)=>area(b)-area(a)).map(current=>{



  featurePoints=Object.fromEntries(current.map((p,i)=>[`mp-${i}`,[p.x,p.y]]));

  const fitted=FaceMixFitting.fitLandmarks(template,current,reference,image.width,image.height,headMask,analysisMasks);
  landmarks=fitted.landmarks;observation=fitted.observation;
  const xs=current.map(p=>p.x),ys=current.map(p=>p.y);return {landmarks,featurePoints,observation,note:[note,fitted.note].filter(Boolean).join(' '),bounds:[Math.max(0,Math.min(...xs)),Math.max(0,Math.min(...ys)),Math.min(1,Math.max(...xs)),Math.min(1,Math.max(...ys))]};});
  ({landmarks,featurePoints,observation,note}=candidates[0]);

 }else{landmarks=template.points.map(def=>({id:def.id,x:def.reference[0],y:def.reference[1],enabled:true,locked:false,authored:false,confidence:.15}));note='No face detected. A complete editable template is available.';}

 return {landmarks,mask,analysisMasks,note,featurePoints,observation,faces:candidates?.length>1?candidates:undefined,fitVersion:FaceMixFitting.FIT_VERSION,found:faces.length>0};
 }finally{if(image!==bitmap)image.close();bitmap.close();}

}

function area(points){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return (Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));}



// Retain bounded selection caches, not full-size per-class inference buffers.
function compactMask(values,width,height,category){const scale=Math.min(1,256/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),data=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const value=values[Math.min(height-1,Math.floor((y+.5)/h*height))*width+Math.min(width-1,Math.floor((x+.5)/w*width))];data[y*w+x]=category===undefined?Math.round(255*Math.max(0,Math.min(1,value))):value===category?255:0;}return {width:w,height:h,data};}

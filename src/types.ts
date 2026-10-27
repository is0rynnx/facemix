export const REGIONS = ['eyes','brows','nose','mouth','outline','hair','ears','neck','clothing'] as const;

export type Region = typeof REGIONS[number];

export type Vec = [number, number];

export interface Landmark { id: string; x: number; y: number; enabled: boolean; locked: boolean; authored: boolean; confidence: number; autoDisabled?:boolean; review?:string; }

export interface PointDefinition { id: string; name: string; region: Region; reference: Vec; mirror?: string; detectorIndex?:number; }

export interface Template { id: string; version: number; name: string; points: PointDefinition[]; contours: {name:string; ids:string[]; closed:boolean}[]; }

export interface Mask { width:number; height:number; data:Uint8Array; }

export type AnalysisMasks=Partial<Record<'face'|'hair'|'body'|'clothing'|'accessories',Mask>>;

export interface Source {

  id:string; name:string; width:number; height:number; enabled:boolean; originalAssetId?:string;

  shapeWeight:number; appearanceWeight:number; weightLocked:boolean;

  regionWeights:Record<Region,{shape:number;appearance:number}>;

  landmarks:Landmark[]; subjectMask?:Mask; exclusionMask?:Mask;

  analysisMasks?:AnalysisMasks;

  featurePoints?:Record<string,Vec>; observation?:{turn:number;mouthOpen:number;gaze:Vec}; provenance?:string;

  fitVersion?:number; status:'preparing'|'ready'|'manual'|'error'; note?:string;

}

export interface Recipe {

  linked:boolean; warp:'mls'|'triangles'; blend:'linear'|'srgb';

  background:'solid'|'transparent'|'source'; backgroundColor:string; backgroundSourceId?:string;

  removeBackground:boolean; colorMatch:boolean; decontaminate:number; feather:number;

  aspect:number; outputSize:number; pins:Record<string,Vec>; frameAnchors:boolean; frameScale:number; frameOffsetY:number;

  cropFeather:number; fillMissing:boolean; regionFeather:number; gaze:'average'|'center';

  regionSources?:Partial<Record<Region,{shape?:string;appearance?:string}>>;
  faceEdits?:import('./engine/face-edits').FaceEdits;
  flipOutput?:boolean;
  /** Legacy archive field; the current editor uses one keypoint layout. */
  landmarkMode?:'anchors'|'full';
  earControls?:boolean;
  hairControls?:boolean;
  regionMasks?:Partial<Record<Region,{width:number;height:number;data:number[]}>>;

}

export interface Variant { id:string; name:string; sources:Source[]; recipe:Recipe; template?:Template; created:number; thumbnail?:string; }

export interface Project { schemaVersion:1; engineVersion?:number; id:string; name:string; template:Template; sources:Source[]; recipe:Recipe; variants:Variant[]; revision:number; }

export interface Diagnostic { kind:'warning'|'error'; message:string; sourceId?:string; position?:Vec; code?:string; pointIds?:string[]; }

export interface RenderSpec { revision:number; sources:Source[]; template:Template; recipe:Recipe; size:number; quality:'preview'|'final'; inspectSourceId?:string; }

export interface RenderOutput { type:'result'; job:number; revision:number; bitmap?:ImageBitmap; blob?:Blob; width:number; height:number; ms:number; vertices:number; diagnostics:Diagnostic[]; backend:string; }

export interface DetectedFace {bounds:[number,number,number,number];landmarks:Landmark[];featurePoints?:Source['featurePoints'];observation?:Source['observation'];note?:string;}

export interface DetectionResult { faces?:DetectedFace[]; fitVersion?:number; landmarks:Landmark[]; mask?:Mask; analysisMasks?:AnalysisMasks; note?:string; featurePoints?:Source['featurePoints']; observation?:Source['observation']; }

export const defaultRecipe = ():Recipe => ({ linked:true, warp:'triangles', blend:'linear', background:'solid', backgroundColor:'#d7d6d2', removeBackground:true, colorMatch:true, decontaminate:0, feather:0, cropFeather:4/2048, fillMissing:true, regionFeather:.012, gaze:'average', aspect:0.8, outputSize:2048, pins:{}, frameAnchors:false, hairControls:false, frameScale:.9, frameOffsetY:.02 });

export const regionDefaults = () => Object.fromEntries(REGIONS.map(r=>[r,{shape:1,appearance:1}])) as Source['regionWeights'];

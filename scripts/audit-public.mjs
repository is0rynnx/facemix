import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const catalog=JSON.parse(await fs.readFile('public/library/catalog.json','utf8'));
assert.equal(catalog.entries.length,492);
assert(catalog.entries.every(entry=>entry.id.startsWith('phenotypes-')&&!entry.source));
assert(catalog.collections.every(folder=>folder.id.startsWith('phenotypes')));
const listed=new Set();
for(const entry of catalog.entries)for(const key of ['url','thumbnail','mask','preparation']){
 const file=entry[key];assert(file&&!file.includes('..')&&!file.includes('://'));
 assert(/^(library\/phenotypes\/|library\/prepared\/phenotypes-)/.test(file));
 listed.add(file);await fs.stat('public/'+file);
}
const inventory=JSON.parse(await fs.readFile('public/PUBLIC_ASSETS.json','utf8'));
assert.deepEqual([...listed].sort(),inventory.allowedLibraryFiles);
const fixture=JSON.parse(await fs.readFile('public/demo/fixture.json','utf8'));
assert(fixture.sources.every(source=>listed.has(source.url)&&source.preparedLandmarks.length>0));
const calibration=JSON.parse(await fs.readFile('src/detector-calibration.json','utf8'));
const publicFace=JSON.parse(await fs.readFile('public/library/prepared/phenotypes-faces-annamidf.jpg.json','utf8'));
for(let i=0;i<478;i++){const point=publicFace.featurePoints['mp-'+i];assert.equal(calibration[i][0],.5+(point[0]-.5)*(publicFace.width/publicFace.height)/.8);assert.equal(calibration[i][1],point[1]);}
async function walk(dir){let files=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert(!entry.isSymbolicLink());if(entry.isDirectory())files.push(...await walk(file));else files.push(file);}return files;}
for(const file of await walk('dist')){
 const relative=path.relative('dist',file).split(path.sep).join('/');
 assert(/^(assets\/|models\/|workers\/|library\/(phenotypes\/|prepared\/phenotypes-|catalog\.json$|privacy\.json$)|demo\/fixture\.json$|favicon\.svg$|index\.html$|PUBLIC_ASSETS\.json$|\.nojekyll$)/.test(relative),'Unexpected published file: '+relative);
 if(/\.(json|js|html)$/.test(relative)){const data=await fs.readFile(file,'utf8');assert(!/[A-Z]:[\\/]+Users[\\/]/.test(data),'Local path in '+relative);}
}
console.log('Asset check passed.');

import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const name=`CrescentMusic-${pkg.version}`,folder=path.join(root,'release',name);
const info=JSON.parse(await fs.readFile(path.join(folder,'BUILD-INFO.json'),'utf8'));
if(!info.clean||info.dataPolicy!=='portable-only')throw new Error('只能归档干净公开构建');
for(const directory of ['Data','Music'])if((await fs.readdir(path.join(folder,directory))).length)throw new Error(`公开成品 ${directory} 必须为空`);
const archive=path.join(root,'release',`${name}-${process.platform}-${process.arch}.zip`);
try{await fs.access(archive);throw new Error('归档已存在，请先移走旧归档');}catch(error){if(error.code!=='ENOENT')throw error;}
const result=spawnSync('tar',['-a','-cf',archive,'-C',path.dirname(folder),name],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;if(result.status!==0)throw new Error('ZIP 归档失败');
const digest=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
await fs.writeFile(archive+'.sha256',`${digest}  ${path.basename(archive)}\n`);
console.log(path.relative(root,archive));

import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const parent=path.join(root,'open-source'),out=path.join(parent,'CrescentMusic');
const refresh=process.argv.includes('--refresh');
try{await fs.access(out);if(!refresh)throw new Error('源码导出目录已存在，请先移走旧导出，或用 --refresh 更新已审核文件');}catch(error){if(error.code!=='ENOENT')throw error;}
const entries=['src','scripts','tests','docs','.github','.gitignore','.gitattributes','package.json','package-lock.json','README.md','LICENSE','THIRD-PARTY-NOTICES.txt','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','AGENTS.md','启动播放器.cmd'];
const files=[];
async function visit(relative){
 const filename=path.join(root,relative),stat=await fs.lstat(filename);
 if(stat.isSymbolicLink())throw new Error(`源码含符号链接：${relative}`);
 if(stat.isDirectory()){for(const entry of await fs.readdir(filename))await visit(path.join(relative,entry));return;}
 const name=relative.replaceAll(path.sep,'/'),extension=path.extname(name).toLowerCase();
 const audio=/^tests\/(fixtures\/(Moonrise\.mp3|Afterglow\.flac)|seek-fixtures\/Seek\.(mp3|flac))$/.test(name);
 const art=name==='tests/fixtures/cover.png'||/^src\/assets\/taskbar\/[a-z]+\.png$/.test(name);
 if(!audio&&!art&&!['.js','.mjs','.cjs','.json','.html','.css','.md','.txt','.py','.cmd','.yml',''].includes(extension)&&!['.gitignore','.gitattributes'].includes(name))throw new Error(`未授权导出文件类型：${name}`);
 const data=await fs.readFile(filename);
 if(!audio&&!art){
  const text=data.toString('utf8');
  if(/[A-Z]:[\\/](Users|CrescentMusic|CloudMusic|RA2_DIY)[\\/]/i.test(text))throw new Error(`发现本机路径：${name}`);
  if(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{24,})\b/.test(text))throw new Error(`发现疑似凭据：${name}`);
  if(/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw new Error(`发现私钥：${name}`);
 }
 files.push({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
for(const entry of entries)await visit(entry);
for(const entry of entries)await fs.cp(path.join(root,entry),path.join(out,entry),{recursive:true});
const approved=new Map(files.map(file=>[file.path,file.sha256]));
async function verifyExport(relative){
 const filename=path.join(out,relative),stat=await fs.lstat(filename);
 if(stat.isSymbolicLink())throw new Error('导出目录含符号链接');
 if(stat.isDirectory()){for(const entry of await fs.readdir(filename))await verifyExport(path.join(relative,entry));return;}
 const name=relative.replaceAll(path.sep,'/'),hash=createHash('sha256').update(await fs.readFile(filename)).digest('hex');
 if(approved.get(name)!==hash)throw new Error(`导出目录存在未审核或过期文件：${name}`);
}
for(const entry of entries)await verifyExport(entry);
await fs.writeFile(path.join(out,'PUBLIC-SOURCE-MANIFEST.json'),JSON.stringify({version:pkg.version,files:files.sort((a,b)=>a.path.localeCompare(b.path))},null,2));
const zip=path.join(parent,`CrescentMusic-${pkg.version}-source.zip`);
const result=spawnSync('tar',['-a','-cf',zip,'-C',parent,...[...entries,'PUBLIC-SOURCE-MANIFEST.json'].map(entry=>`CrescentMusic/${entry}`)],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;if(result.status!==0)throw new Error('源码 ZIP 失败');
await fs.writeFile(zip+'.sha256',`${createHash('sha256').update(await fs.readFile(zip)).digest('hex')}  ${path.basename(zip)}\n`);
console.log(`Exported ${files.length} reviewed files: ${path.relative(root,out)} and ${path.relative(root,zip)}`);
